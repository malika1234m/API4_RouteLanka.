/**
 * Field records from the driver's phone, and delay reports that arrive by SMS.
 *
 * Every record carries an id made on the phone. It is inserted into field_records first; if that id is
 * already there, the record is a re-send (a flaky connection, a retry after a timeout) and is skipped.
 * Records keep the time they were recorded on the phone, not the time they reached the server.
 */
import { DELAY_REASONS, parseDelaySms, toMin, type FieldEvent } from "@routelanka/domain";
import type { Account } from "./auth";
import { HttpError } from "./auth";
import { recordDelay, reconnect } from "./commands";
import { sql, type Tx } from "./db";
import { lockDay, now, skipTo, type Day } from "./day";
import { appendEvent } from "./events";
import { ensureStatus, vehicleOf } from "./runs";

async function applyRecord(tx: Tx, day: Day, e: FieldEvent, offline: boolean, who: Account): Promise<{ day: Day; applied: boolean }> {
  const vid = vehicleOf(day, who);
  await ensureStatus(tx, day.id, vid);
  const [o] = await tx<{ outlet_id: string; stage: string; reassigned_to: string | null; handover_code: string | null; pred_window: string | null; vehicle_id: string | null }[]>`
    SELECT o.outlet_id, p.stage, p.reassigned_to, p.handover_code, a.pred_window, a.vehicle_id
    FROM orders o JOIN order_progress p USING (workspace_id, order_ref) JOIN assignments a USING (workspace_id, order_ref)
    WHERE o.workspace_id = ${day.id} AND o.order_ref = ${e.order_ref}`;
  if (!o || o.vehicle_id !== vid) throw new HttpError(400, `${e.order_ref} is not on this driver's run.`);
  // The flow is load, release, deliver: nothing is recorded at a store before the loader releases the truck.
  if (!["on_road", "delivered", "received"].includes(o.stage)) throw new HttpError(409, `${o.outlet_id}: the truck hasn't left the dock yet. The loader releases it first.`);

  let at = e.at;
  if (!offline && e.type === "arrived") {
    // Demo only: skip the drive to the stop's predicted arrival, and record the arrival then.
    day = await skipTo(tx, day, o.pred_window?.split("-")[0]);
    at = now(day);
  } else if (/^\d\d:\d\d$/.test(at) && toMin(at) > toMin(now(day))) {
    // A record made offline after a skipped drive: bring the day's clock up to it.
    day = await skipTo(tx, day, at);
  }

  const [fresh] = await tx`INSERT INTO field_records (id, workspace_id, vehicle_id, order_ref, type, recorded_at, payload, offline)
                           VALUES (${e.id}, ${day.id}, ${vid}, ${e.order_ref}, ${e.type}, ${at}, ${tx.json((e.payload ?? {}) as never)}, ${offline})
                           ON CONFLICT (id) DO NOTHING RETURNING 1`;
  if (!fresh) return { day, applied: false };

  if (e.type === "arrived") {
    await tx`UPDATE order_progress SET arrived_at = coalesce(arrived_at, ${at}) WHERE workspace_id = ${day.id} AND order_ref = ${e.order_ref}`;
    await appendEvent(tx, day.id, at, { type: "stop.arrived", role: who.role, ref: e.order_ref, text: `${vid} arrived at ${o.outlet_id}`, inFeed: false, payload: { offline } });
  } else {
    const p = e.payload ?? {};
    // The server holds the real code; the phone only had its hash. Check it again here.
    const pod = p.pod?.method === "code" && p.pod.code !== o.handover_code ? { ...p.pod, verified: false } : p.pod ? { ...p.pod, verified: p.pod.method === "code" } : null;
    await tx`UPDATE order_progress SET
               stage = CASE WHEN stage = 'received' THEN 'received' ELSE 'delivered' END,
               delivered_at = ${at}, delivered_units = ${p.deliveredUnits ?? null}, exception = ${p.exception ?? null},
               pod = ${pod ? tx.json(pod as never) : null}, recorded_offline = ${offline}, synced_at = ${offline ? now(day) : null},
               reassigned_to = NULL
             WHERE workspace_id = ${day.id} AND order_ref = ${e.order_ref}`;
    await appendEvent(tx, day.id, at, {
      type: "stop.delivered",
      role: who.role,
      ref: e.order_ref,
      text: `${o.outlet_id} delivered at ${at}${pod?.method === "code" ? (pod.verified ? ", verified with the store's handover code" : "") : pod ? `, signed by ${pod.name}` : ""}${offline ? " (recorded without signal)" : ""}`,
      payload: { offline, units: p.deliveredUnits ?? null, exception: p.exception ?? null, pod: pod ? { method: pod.method, verified: pod.verified } : null },
    });
    if (pod?.method === "code" && !pod.verified)
      await appendEvent(tx, day.id, at, { type: "stop.proof_mismatch", role: who.role, kind: "issue", open: true, ref: e.order_ref, text: `${o.outlet_id}: the handover code entered doesn't match the store's code. Check with the store.` });
    if (p.exception)
      await appendEvent(tx, day.id, at, { type: "stop.exception", role: who.role, kind: "issue", open: true, ref: e.order_ref, text: `Driver reported "${p.exception}" at ${o.outlet_id}` });
    // Field facts win: a delivery recorded before a reassignment reached the phone stands.
    if (o.reassigned_to)
      await appendEvent(tx, day.id, at, { type: "stop.reassignment_overtaken", role: who.role, kind: "issue", open: true, ref: e.order_ref, text: `${o.outlet_id} was delivered by the original driver at ${at} before your reassignment reached them. Cancel the stop on ${o.reassigned_to}.` });
  }
  await tx`UPDATE driver_status SET last_contact = ${at}, last_contact_stop = ${e.order_ref} WHERE workspace_id = ${day.id} AND vehicle_id = ${vid}`;
  return { day, applied: true };
}

/** Records from the phone. `offline` marks a batch saved while the phone had no signal. */
export async function syncRecords(dayId: string, events: FieldEvent[], offline: boolean, who: Account) {
  return sql.begin(async (tx) => {
    let day = await lockDay(tx, dayId);
    let accepted = 0;
    let duplicates = 0;
    const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    for (const e of sorted) {
      const r = await applyRecord(tx, day, e, offline, who);
      day = r.day;
      if (r.applied) accepted++;
      else duplicates++;
    }
    let conflicts: { ref: string; to: string }[] = [];
    if (offline) {
      const delivered = sorted.filter((e) => e.type === "delivered").length;
      const arrived = sorted.length - delivered;
      conflicts = await reconnect(tx, day, vehicleOf(day, who), delivered, arrived);
      if (accepted)
        await appendEvent(tx, day.id, now(day), {
          type: "driver.synced",
          role: who.role,
          kind: "sync",
          text: `${vehicleOf(day, who)} back online: ${delivered} ${delivered === 1 ? "delivery" : "deliveries"} and ${arrived} arrival ${arrived === 1 ? "time" : "times"} synced, with the times they were recorded`,
          payload: { accepted, duplicates, delivered, arrived },
        });
      else await appendEvent(tx, day.id, now(day), { type: "driver.online", role: who.role, text: `${vehicleOf(day, who)} back online`, inFeed: false });
    }
    return { accepted, duplicates, conflicts };
  });
}

/** An SMS from a driver's phone, as posted by the SMS gateway. */
export async function inboundSms(dayId: string, body: string) {
  const d = parseDelaySms(body);
  if (!d) throw new HttpError(400, "Not a RouteLanka delay report.");
  return sql.begin(async (tx) => {
    const day = await lockDay(tx, dayId);
    // Only a vehicle with a driver's phone on it (an active driver account, or the demo run) can report.
    const [known] = await tx`SELECT 1 FROM users WHERE role = 'driver' AND active AND vehicle_id = ${d.vehicle_id}`;
    if (!known && d.vehicle_id !== day.meta.personas.driver.vehicle_id) throw new HttpError(400, "Unknown vehicle.");
    const label = DELAY_REASONS.find((r) => r.id === d.reason)!.label;
    await recordDelay(tx, day, d.vehicle_id, { reason: d.reason, minutes: d.minutes, near: d.near, label, smsDone: d.done }, "driver", true);
    return { ok: true };
  });
}

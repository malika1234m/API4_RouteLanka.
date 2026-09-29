/**
 * Write side: one handler per command. Every handler runs in one transaction that
 *   1. locks the demo day (commands on one day apply in order),
 *   2. validates against the operating rules and the current state,
 *   3. changes state,
 *   4. appends the domain event (the outbox) that tells every other role.
 * The API never calls the notifier or other screens directly: the event does that.
 */
import { checkMove, planViolations, tripKey, type Command, type District, type Order, type RuleRef, type Vehicle } from "@routelanka/domain";
import { randomInt } from "node:crypto";
import type { Account } from "./auth";
import { HttpError } from "./auth";
import { sql, type Tx } from "./db";
import { lockDay, now, skipTo, type Day } from "./day";
import { appendEvent } from "./events";

const REF_CACHE: { districts?: Map<string, District>; allowance?: Map<string, number> } = {};

async function ruleRef(tx: Tx, vehicles: Vehicle[]): Promise<RuleRef> {
  if (!REF_CACHE.districts) {
    const ds = await tx<District[]>`SELECT * FROM districts`;
    REF_CACHE.districts = new Map(ds.map((d) => [d.district, d]));
    const al = await tx<{ brand: string; dock_type: string; minutes: number }[]>`SELECT * FROM service_allowance`;
    REF_CACHE.allowance = new Map(al.map((a) => [`${a.brand}|${a.dock_type}`, a.minutes]));
  }
  const vs = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  return {
    district: (n) => REF_CACHE.districts!.get(n),
    allowance: (b, d) => REF_CACHE.allowance!.get(`${b}|${d}`) ?? 15,
    vehicle: (id) => vs.get(id),
  };
}

async function planState(tx: Tx, day: Day) {
  const orders = await tx<Order[]>`
    SELECT o.order_ref, o.outlet_id, o.brand, o.district, o.depot, t.dock_type, t.parking_constraint, o.temp_requirement,
           o.order_units, o.order_weight_kg, o.order_volume_m3, a.decision, a.vehicle_id, a.trip_id, a.stop_seq
    FROM orders o JOIN outlets t USING (outlet_id) JOIN assignments a ON a.workspace_id = o.workspace_id AND a.order_ref = o.order_ref
    WHERE o.workspace_id = ${day.id} AND o.run_date = ${day.service_date}::date`;
  const vehicles = await tx<Vehicle[]>`
    SELECT v.vehicle_id, v.type, v.temp, v.weight_cap_kg, v.volume_cap_m3, v.km_per_l, v.weekly_fuel_quota_l, v.depot, d.status, d.fuel_used_l
    FROM vehicles v JOIN vehicle_day d USING (vehicle_id) WHERE d.workspace_id = ${day.id}`;
  return { orders, vehicles, ref: await ruleRef(tx, vehicles) };
}

async function orderOf(tx: Tx, day: Day, ref: string) {
  const [o] = await tx<(Order & { stage: string; load_flag: { qty: number; kind: string } | null; reassigned_to: string | null; deferred_en_route: string | null; handover_code: string | null })[]>`
    SELECT o.*, a.decision, a.vehicle_id, a.trip_id, a.stop_seq, a.pred_window, p.stage, p.load_flag, p.reassigned_to, p.deferred_en_route, p.handover_code
    FROM orders o JOIN assignments a USING (workspace_id, order_ref) JOIN order_progress p USING (workspace_id, order_ref)
    WHERE o.workspace_id = ${day.id} AND o.order_ref = ${ref}`;
  if (!o) throw new HttpError(404, `Order ${ref} is not on this run.`);
  return o;
}

async function bumpPlan(tx: Tx, day: Day) {
  if (!day.published) return;
  await tx`UPDATE workspaces SET plan_version = plan_version + 1, plan_changed_at = ${now(day)} WHERE id = ${day.id}`;
}

const newCode = () => String(randomInt(0, 10000)).padStart(4, "0");

type Handler<C extends Command> = (tx: Tx, day: Day, c: C, who: Account) => Promise<unknown>;
type Handlers = { [K in Command["type"]]: Handler<Extract<Command, { type: K }>> };

const handlers: Handlers = {
  async publish(tx, day, _c, who) {
    const { orders, vehicles, ref } = await planState(tx, day);
    const problems = planViolations(ref, vehicles, orders);
    if (problems.length) throw new HttpError(409, `This plan breaks ${problems.length} rule${problems.length > 1 ? "s" : ""}: ${problems[0]}`);
    const at = now(day);
    await tx`
      UPDATE order_progress p SET
        stage = CASE WHEN a.decision = 'served' AND p.stage = 'ordered' THEN 'planned' WHEN a.decision = 'deferred' THEN 'ordered' ELSE p.stage END,
        deferred = (a.decision = 'deferred')
      FROM assignments a WHERE a.workspace_id = p.workspace_id AND a.order_ref = p.order_ref AND p.workspace_id = ${day.id}`;
    for (const o of orders.filter((x) => x.decision === "served"))
      await tx`UPDATE order_progress SET handover_code = ${newCode()} WHERE workspace_id = ${day.id} AND order_ref = ${o.order_ref} AND handover_code IS NULL`;
    const served = orders.filter((o) => o.decision === "served").length;
    const deferred = orders.length - served;
    const version = day.published ? day.plan_version + 1 : day.plan_version;
    await tx`UPDATE workspaces SET published = true, plan_version = ${version}, plan_changed_at = ${day.published ? at : null} WHERE id = ${day.id}`;
    await tx`INSERT INTO plan_versions (workspace_id, version, published_at, served, deferred, snapshot)
             VALUES (${day.id}, ${version}, ${at}, ${served}, ${deferred}, ${tx.json(orders.map((o) => ({ ref: o.order_ref, d: o.decision, v: o.vehicle_id ?? null, t: o.trip_id ?? null })) as never)})
             ON CONFLICT (workspace_id, version) DO UPDATE SET published_at = EXCLUDED.published_at, snapshot = EXCLUDED.snapshot`;
    await appendEvent(tx, day.id, at, {
      type: "plan.published",
      role: who.role,
      kind: "decision",
      text: day.published ? `Plan changes published (version ${version})` : `Plan published: ${served} orders planned, ${deferred} deferred with reasons sent to stores`,
      payload: { version, served, deferred, republish: day.published },
    });
  },

  async proposePlan(tx, day, _c, who) {
    if (day.published) throw new HttpError(409, "The plan is already published. Change it on the board instead.");
    const [job] = await tx<{ id: string }[]>`INSERT INTO plan_jobs (workspace_id) VALUES (${day.id}) RETURNING id`;
    await appendEvent(tx, day.id, now(day), { type: "plan.requested", role: who.role, text: "Asked the planner for a fresh proposal", inFeed: false, payload: { job_id: job.id } });
    return { job: job.id };
  },

  async move(tx, day, c, who) {
    const { orders, ref } = await planState(tx, day);
    const o = orders.find((x) => x.order_ref === c.ref);
    if (!o) throw new HttpError(404, `Order ${c.ref} is not on this run.`);
    const problems = checkMove(ref, orders, c.ref, c.vehicle_id, c.trip_id);
    if (problems.length) throw new HttpError(409, problems[0]);
    const [{ seq }] = await tx<{ seq: number }[]>`SELECT coalesce(max(stop_seq), 0) + 1 AS seq FROM assignments WHERE workspace_id = ${day.id} AND vehicle_id = ${c.vehicle_id} AND trip_id = ${c.trip_id}`;
    await tx`UPDATE assignments SET decision = 'served', reason = NULL, vehicle_id = ${c.vehicle_id}, trip_id = ${c.trip_id}, stop_seq = ${seq}
             WHERE workspace_id = ${day.id} AND order_ref = ${c.ref}`;
    await ensureTrip(tx, day, c.vehicle_id, c.trip_id, o);
    await dropEmptyTrips(tx, day);
    await bumpPlan(tx, day);
    await appendEvent(tx, day.id, now(day), { type: "plan.changed", role: who.role, kind: "decision", ref: c.ref, text: `${o.outlet_id} moved to ${c.vehicle_id} trip ${c.trip_id}`, inFeed: day.published, payload: { vehicle_id: c.vehicle_id, trip_id: c.trip_id } });
  },

  async defer(tx, day, c, who) {
    const o = await orderOf(tx, day, c.ref);
    await tx`UPDATE assignments SET decision = 'deferred', reason = ${c.reason}, vehicle_id = NULL, trip_id = NULL, stop_seq = NULL WHERE workspace_id = ${day.id} AND order_ref = ${c.ref}`;
    await dropEmptyTrips(tx, day);
    await bumpPlan(tx, day);
    await appendEvent(tx, day.id, now(day), { type: "plan.changed", role: who.role, kind: "decision", ref: c.ref, text: `${o.outlet_id} deferred to the next run`, inFeed: day.published, payload: { reason: c.reason } });
  },

  async loadTick(tx, day, c, who) {
    requirePublished(day);
    await tx`UPDATE order_progress SET stage = 'loaded', load_flag = CASE WHEN load_decision IS NULL THEN NULL ELSE load_flag END
             WHERE workspace_id = ${day.id} AND order_ref = ${c.ref} AND stage IN ('planned', 'loaded')`;
    await appendEvent(tx, day.id, now(day), { type: "load.ticked", role: who.role, ref: c.ref, text: `Loaded ${c.ref}`, inFeed: false });
  },

  async loadUntick(tx, day, c, who) {
    requirePublished(day);
    await tx`UPDATE order_progress SET stage = 'planned' WHERE workspace_id = ${day.id} AND order_ref = ${c.ref} AND stage = 'loaded'`;
    await appendEvent(tx, day.id, now(day), { type: "load.unticked", role: who.role, ref: c.ref, text: `Unloaded ${c.ref}`, inFeed: false });
  },

  async loadFlag(tx, day, c, who) {
    requirePublished(day);
    const o = await orderOf(tx, day, c.ref);
    if (c.issue.qty < 1 || c.issue.qty > o.order_units) throw new HttpError(400, "Quantity must be between 1 and the order size.");
    await tx`UPDATE order_progress SET load_flag = ${tx.json(c.issue as never)}, load_decision = NULL WHERE workspace_id = ${day.id} AND order_ref = ${c.ref}`;
    await appendEvent(tx, day.id, now(day), { type: "load.flagged", role: who.role, kind: "issue", open: true, ref: c.ref, text: `Dock: ${c.issue.qty} × ${c.issue.kind} for ${o.outlet_id}. Decide before the vehicle leaves.`, payload: { ...c.issue } });
  },

  async shortfallDecision(tx, day, c, who) {
    const o = await orderOf(tx, day, c.ref);
    const label = { send_short: "Send short", hold: "Hold 15 min for restock", defer_rest: "Defer the remainder" }[c.decision];
    await tx`UPDATE order_progress SET load_decision = ${c.decision}, stage = 'loaded' WHERE workspace_id = ${day.id} AND order_ref = ${c.ref}`;
    await tx`UPDATE events SET open = false WHERE workspace_id = ${day.id} AND order_ref = ${c.ref} AND type = 'load.flagged'`;
    await appendEvent(tx, day.id, now(day), { type: "load.decided", role: who.role, kind: "decision", ref: c.ref, text: `${label} for ${o.outlet_id}. Store notified.`, payload: { decision: c.decision, qty: o.load_flag?.qty ?? 0 } });
  },

  async ready(tx, day, c, who) {
    const [vid, trip] = splitKey(c.key);
    const open = await tx`SELECT 1 FROM order_progress p JOIN assignments a USING (workspace_id, order_ref)
                          WHERE p.workspace_id = ${day.id} AND a.vehicle_id = ${vid} AND a.trip_id = ${trip} AND a.decision = 'served'
                            AND (p.stage = 'planned' OR (p.load_flag IS NOT NULL AND p.load_decision IS NULL))`;
    if (open.length) throw new HttpError(409, "Load or flag every line first, and wait for the dispatcher's decision on flags.");
    await tx`UPDATE trips SET ready_at = ${now(day)} WHERE workspace_id = ${day.id} AND vehicle_id = ${vid} AND trip_id = ${trip}`;
    await appendEvent(tx, day.id, now(day), { type: "trip.ready", role: who.role, text: `${vid} trip ${trip} is ready to leave`, inFeed: false, payload: { vehicle_id: vid, trip_id: trip } });
  },

  async depart(tx, day, c, who) {
    const [vid, trip] = splitKey(c.key);
    const [t] = await tx<{ depart: string; ready_at: string | null; departed_at: string | null }[]>`SELECT depart, ready_at, departed_at FROM trips WHERE workspace_id = ${day.id} AND vehicle_id = ${vid} AND trip_id = ${trip}`;
    if (!t) throw new HttpError(404, "This trip is not in the plan.");
    if (t.departed_at) return;
    if (!t.ready_at) throw new HttpError(409, "Mark the vehicle ready first.");
    // Trucks leave at their planned time: the demo clock skips ahead if loading finished early.
    day = await skipTo(tx, day, t.depart);
    const at = now(day);
    await tx`UPDATE trips SET departed_at = ${at} WHERE workspace_id = ${day.id} AND vehicle_id = ${vid} AND trip_id = ${trip}`;
    const refs = await tx<{ order_ref: string }[]>`
      UPDATE order_progress p SET stage = 'on_road' FROM assignments a
      WHERE a.workspace_id = p.workspace_id AND a.order_ref = p.order_ref AND p.workspace_id = ${day.id}
        AND a.vehicle_id = ${vid} AND a.trip_id = ${trip} AND a.decision = 'served' RETURNING p.order_ref`;
    await appendEvent(tx, day.id, at, { type: "trip.departed", role: who.role, text: `${vid} trip ${trip} left the dock`, payload: { vehicle_id: vid, trip_id: trip, orders: refs.map((r) => r.order_ref) } });
  },

  async setOnline(tx, day, c, who) {
    const vid = day.meta.personas.driver.vehicle_id;
    const at = now(day);
    if (!c.online) {
      await tx`UPDATE driver_status SET online = false, offline_since = ${at} WHERE workspace_id = ${day.id} AND vehicle_id = ${vid} AND online`;
      await appendEvent(tx, day.id, at, { type: "driver.offline", role: who.role, text: `${vid}: no signal since ${at}`, inFeed: false });
      return;
    }
    await reconnect(tx, day, 0, 0);
    await appendEvent(tx, day.id, at, { type: "driver.online", role: who.role, text: `${vid} back online`, inFeed: false });
  },

  async reassign(tx, day, c, who) {
    const o = await orderOf(tx, day, c.ref);
    await tx`UPDATE order_progress SET reassigned_to = ${c.to} WHERE workspace_id = ${day.id} AND order_ref = ${c.ref} AND stage NOT IN ('delivered', 'received')`;
    await bumpPlan(tx, day);
    await appendEvent(tx, day.id, now(day), { type: "stop.reassigned", role: who.role, kind: "decision", ref: c.ref, text: `${o.outlet_id} moved to ${c.to}. The original driver will be told when their phone reconnects.`, payload: { to: c.to } });
  },

  async ackConflict(tx, day, c) {
    const vid = day.meta.personas.driver.vehicle_id;
    await tx`UPDATE driver_status SET conflicts = coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(conflicts) x WHERE x->>'ref' <> ${c.ref}), '[]')
             WHERE workspace_id = ${day.id} AND vehicle_id = ${vid}`;
  },

  async receive(tx, day, c, who) {
    const o = await orderOf(tx, day, c.ref);
    if (!["on_road", "delivered"].includes(o.stage)) throw new HttpError(409, "This order hasn't left the depot yet.");
    await tx`UPDATE order_progress SET stage = 'received', receipt = ${tx.json({ ok: c.ok, issue: c.issue } as never)} WHERE workspace_id = ${day.id} AND order_ref = ${c.ref}`;
    await appendEvent(tx, day.id, now(day), c.ok
      ? { type: "receipt.confirmed", role: who.role, ref: c.ref, text: `${o.outlet_id} received in full`, payload: { ok: true } }
      : { type: "receipt.confirmed", role: who.role, kind: "issue", open: true, ref: c.ref, text: `${o.outlet_id} reported ${c.issue?.qty} × ${c.issue?.kind}${c.issue?.note ? `: "${c.issue.note}"` : ""}`, payload: { ok: false, ...c.issue } });
  },

  async placeOrder(tx, day, c, who) {
    const [u] = await tx<{ outlet_id: string }[]>`SELECT outlet_id FROM users WHERE id = ${who.uid}`;
    const outlet = (c as { outlet_id?: string }).outlet_id ?? u?.outlet_id;
    const [out] = await tx<{ outlet_id: string; brand: string; district: string; depot: string }[]>`SELECT outlet_id, brand, district, depot FROM outlets WHERE outlet_id = ${outlet ?? ""}`;
    if (!out) throw new HttpError(400, "Unknown outlet.");
    const lines = c.lines.filter((l) => l.units > 0);
    if (!lines.length) throw new HttpError(400, "Add at least one item.");
    if (out.brand !== "Fresh" && lines.some((l) => l.temp === "chilled")) throw new HttpError(400, "Only Fresh outlets order chilled goods.");
    // Orders for the next operating day; after the 16:00 cutoff they join the run after that.
    const [{ run_date }] = await tx<{ run_date: string }[]>`
      SELECT min(date)::text AS run_date FROM calendar WHERE is_operating AND date > ${day.service_date}::date`;
    const at = now(day);
    const refs: string[] = [];
    for (const l of lines) {
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE workspace_id = ${day.id} AND source = 'store'`;
      const ref = `ORD-${out.outlet_id.slice(3)}${l.temp === "chilled" ? "C" : "A"}-${String(4127 + (n + 1) * 613)}`;
      await tx`INSERT INTO orders (workspace_id, order_ref, outlet_id, brand, district, depot, temp_requirement, order_units, order_weight_kg, order_volume_m3, run_date, source, placed_at)
               VALUES (${day.id}, ${ref}, ${out.outlet_id}, ${out.brand}, ${out.district}, ${out.depot}, ${l.temp}, ${l.units}, ${l.weight_kg}, ${l.volume_m3}, ${run_date}::date, 'store', ${at})`;
      refs.push(ref);
      await appendEvent(tx, day.id, at, { type: "order.placed", role: who.role, ref, text: `New order ${ref} confirmed for the next run`, payload: { outlet_id: out.outlet_id, units: l.units, temp: l.temp, run_date } });
    }
    return { refs, run_date, at };
  },

  async resolve(tx, day, c) {
    await tx`UPDATE events SET open = false WHERE workspace_id = ${day.id} AND id = ${c.id}`;
  },

  async setLang(tx, day, c) {
    await tx`INSERT INTO user_prefs (workspace_id, role, lang) VALUES (${day.id}, ${c.role}, ${c.lang}) ON CONFLICT (workspace_id, role) DO UPDATE SET lang = EXCLUDED.lang`;
  },

  async ack(tx, day, c, who) {
    const o = await orderOf(tx, day, c.ref);
    const [row] = await tx`UPDATE order_progress SET ack_at = ${now(day)} WHERE workspace_id = ${day.id} AND order_ref = ${c.ref} AND ack_at IS NULL RETURNING 1`;
    if (!row) return;
    await appendEvent(tx, day.id, now(day), { type: "store.acknowledged", role: who.role, ref: c.ref, text: `${o.outlet_id} acknowledged the deferral${c.via === "whatsapp" ? " on WhatsApp" : ""}`, payload: { via: c.via } });
  },

  async repair(tx, day, c, who) {
    const [dup] = await tx`SELECT 1 FROM fleet_actions WHERE workspace_id = ${day.id} AND kind = 'repair' AND vehicle_id = ${c.vehicle_id}`;
    if (dup) return;
    await tx`INSERT INTO fleet_actions (workspace_id, kind, vehicle_id, at, note) VALUES (${day.id}, 'repair', ${c.vehicle_id}, ${now(day)}, ${c.note})`;
    await appendEvent(tx, day.id, now(day), { type: "fleet.repair_requested", role: who.role, kind: "decision", text: c.note, payload: { vehicle_id: c.vehicle_id } });
  },

  async hire(tx, day, c, who) {
    await tx`INSERT INTO fleet_actions (workspace_id, kind, district, m3, cost, at, note) VALUES (${day.id}, 'hire', ${c.district}, ${c.m3}, ${c.cost}, ${now(day)}, ${c.note})`;
    await appendEvent(tx, day.id, now(day), { type: "fleet.hire_requested", role: who.role, kind: "decision", text: c.note, payload: { district: c.district, m3: c.m3, cost: c.cost } });
  },

  async reportDelay(tx, day, c, who) {
    await recordDelay(tx, day, c, who.role, false);
  },

  async planDelay(tx, day, c, who) {
    const at = now(day);
    for (const [ref, choice] of Object.entries(c.plan)) {
      await tx`UPDATE order_progress SET delay_choice = ${choice},
                 reassigned_to = CASE WHEN ${choice} = 'move' THEN ${c.moveTo ?? null} ELSE reassigned_to END,
                 deferred_en_route = CASE WHEN ${choice} = 'defer' THEN 'road' ELSE deferred_en_route END
               WHERE workspace_id = ${day.id} AND order_ref = ${ref} AND stage NOT IN ('delivered', 'received')`;
    }
    await tx`UPDATE events SET open = false WHERE workspace_id = ${day.id} AND type = 'driver.delay_reported'`;
    await tx`UPDATE workspaces SET delay_told_at = ${at}, plan_version = plan_version + 1, plan_changed_at = ${at} WHERE id = ${day.id}`;
    await appendEvent(tx, day.id, at, { type: "delay.planned", role: who.role, kind: "decision", text: c.summary, payload: { plan: c.plan, moveTo: c.moveTo ?? null } });
  },

  async storeReply(tx, day, c, who) {
    const o = await orderOf(tx, day, c.ref);
    const at = now(day);
    const [row] = await tx`UPDATE order_progress SET store_reply = ${tx.json({ reply: c.reply, at } as never)},
                             deferred_en_route = CASE WHEN ${c.reply} = 'tomorrow' THEN 'store' ELSE deferred_en_route END
                           WHERE workspace_id = ${day.id} AND order_ref = ${c.ref} AND store_reply IS NULL RETURNING 1`;
    if (!row) return;
    await appendEvent(tx, day.id, at, c.reply === "tomorrow"
      ? { type: "store.replied", role: who.role, kind: "issue", open: true, ref: c.ref, text: `${o.outlet_id} can't receive late: bring it back, deliver on the next run`, payload: { reply: c.reply } }
      : { type: "store.replied", role: who.role, ref: c.ref, text: `${o.outlet_id} will wait for the late delivery`, payload: { reply: c.reply } });
  },
};

function requirePublished(day: Day) {
  if (!day.published) throw new HttpError(409, "Tonight's plan isn't published yet.");
}

function splitKey(key: string): [string, number] {
  const [vid, t] = key.split("#");
  const trip = Number(t);
  if (!vid || ![1, 2].includes(trip)) throw new HttpError(400, "Bad trip key.");
  return [vid, trip];
}

/** A move onto a vehicle with no trip yet opens one, departing at the start of its window. */
async function ensureTrip(tx: Tx, day: Day, vid: string, trip: number, o: Order) {
  await tx`INSERT INTO trips (workspace_id, vehicle_id, trip_id, brand, district, depot, depart, minutes, km, fuel_l)
           VALUES (${day.id}, ${vid}, ${trip}, ${o.brand}, ${o.district}, ${o.depot}, ${o.brand === "Fresh" ? "03:30" : "07:30"}, 0, 0, 0)
           ON CONFLICT DO NOTHING`;
}

async function dropEmptyTrips(tx: Tx, day: Day) {
  await tx`DELETE FROM trips t WHERE t.workspace_id = ${day.id} AND t.departed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.workspace_id = t.workspace_id AND a.vehicle_id = t.vehicle_id AND a.trip_id = t.trip_id AND a.decision = 'served')`;
}

/**
 * A delay report from the driver. With data signal it arrives through the app; without, as an SMS to the
 * gateway, which also carries the deliveries still saved on the phone (so no delivered stop is reported late).
 */
export async function recordDelay(tx: Tx, day: Day, c: { reason: string; minutes: number; near: string; label: string; smsDone?: { ref: string; at: string }[] }, role: Account["role"], viaSms: boolean) {
  const vid = day.meta.personas.driver.vehicle_id;
  const at = now(day);
  const smsDone = viaSms ? c.smsDone ?? [] : [];
  const delay = { at, reason: c.reason, minutes: c.minutes, via: viaSms ? "sms" : "app", near: c.near, smsDone };
  await tx`UPDATE driver_status SET delay = ${tx.json(delay as never)} WHERE workspace_id = ${day.id} AND vehicle_id = ${vid}`;
  const outlets = new Map((await tx<{ order_ref: string; outlet_id: string }[]>`SELECT order_ref, outlet_id FROM orders WHERE workspace_id = ${day.id}`).map((r) => [r.order_ref, r.outlet_id]));
  const also = smsDone.length ? ` Also delivered: ${smsDone.map((d) => `${outlets.get(d.ref) ?? d.ref} at ${d.at}`).join(", ")}.` : "";
  await appendEvent(tx, day.id, at, {
    type: "driver.delay_reported",
    role,
    kind: "issue",
    open: true,
    text: `${viaSms ? "SMS from" : "Report from"} ${vid}: ${c.label.toLowerCase()} near ${c.near}, about ${c.minutes} min delay.${also} Decide the remaining stops.`,
    payload: delay,
  });
}

/**
 * The phone is back in contact. Records it sent while offline have already been applied by /sync.
 * Work out which of its stops the dispatcher changed meanwhile, so the driver is told on screen.
 */
export async function reconnect(tx: Tx, day: Day, delivered: number, arrived: number) {
  const vid = day.meta.personas.driver.vehicle_id;
  const conflicts = await tx<{ ref: string; to: string }[]>`
    SELECT p.order_ref AS ref, coalesce(p.reassigned_to, 'depot') AS "to" FROM order_progress p JOIN assignments a USING (workspace_id, order_ref)
    WHERE p.workspace_id = ${day.id} AND a.vehicle_id = ${vid} AND (p.reassigned_to IS NOT NULL OR p.deferred_en_route IS NOT NULL)
      AND p.stage NOT IN ('delivered', 'received')`;
  const at = now(day);
  await tx`UPDATE driver_status SET online = true, offline_since = NULL, conflicts = ${tx.json(conflicts as never)},
             last_sync = ${tx.json({ at, count: delivered + arrived, delivered, arrived } as never)}
           WHERE workspace_id = ${day.id} AND vehicle_id = ${vid}`;
  return conflicts;
}

export async function runCommand(dayId: string, cmd: Command, who: Account) {
  return sql.begin(async (tx) => {
    const day = await lockDay(tx, dayId);
    const h = handlers[cmd.type] as Handler<Command>;
    return (await h(tx, day, cmd, who)) ?? { ok: true };
  });
}

export { tripKey };

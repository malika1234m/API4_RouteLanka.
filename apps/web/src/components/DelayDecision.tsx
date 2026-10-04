"use client";

import { useState } from "react";
import { Btn, Card, Chip, IconCheck, IconChill } from "@/components/ui";
import { delayedEta, heldUp } from "@/lib/delay";
import { compatibleSwap } from "@/lib/monitor";
import { DELAY_REASONS, disrupted, extraMinutes } from "@/lib/roads";
import { runFor, runKey } from "@/lib/runs";
import { vehicleById } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";

type Choice = "late" | "move" | "defer";
const IDLE_L_PER_H = 3; // assumption: a refrigerated truck idling with the unit on

/** Monsoon early warning: which districts' roads are disrupted today, from road_conditions.csv. */
export function RoadBanner({ compact = false }: { compact?: boolean }) {
  const DISRUPTED = disrupted();
  if (!DISRUPTED.length) return null;
  const ex = DISRUPTED.map(([, v]) => extraMinutes(v) - extraMinutes(100));
  return (
    <div className={`rounded-md border border-hivis/60 bg-amber-soft px-3 py-2 text-sm ${compact ? "" : "mt-3"}`} role="status">
      <span className="font-semibold text-hivis-deep">Monsoon day: roads disrupted in {DISRUPTED.map(([d, v]) => `${d} (${v})`).join(", ")}.</span>{" "}
      <span>On days like this, legs there run {Math.min(...ex)} to {Math.max(...ex)} min longer than usual. Road index from road_conditions.csv; 100 is normal.</span>
    </div>
  );
}

/**
 * The dispatcher's recovery card when a driver reports a delay: every remaining stop, re-timed, with a
 * choice and its consequence. Without `vid` it shows the run whose delay has waited longest for a decision.
 */
export function DelayDecision({ vid: forVid }: { vid?: string }) {
  const { s, dispatch } = useDemo();
  const runs = s.drivers.map((r) => runFor(s, runKey(r))!).filter((r) => r.delay);
  const run = forVid ? runs.find((r) => r.vehicle_id === forVid) : ([...runs].sort((a, b) => Number(!!a.delay!.toldAt) - Number(!!b.delay!.toldAt) || a.delay!.at.localeCompare(b.delay!.at))[0]);
  const d = run?.delay;
  const vid = run?.vehicle_id ?? "";
  const orders = s.orders.filter((o) => o.vehicle_id === vid && (heldUp(s, o) || s.delayPlan[o.order_ref])).sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0));
  const pending = orders.filter((o) => heldUp(s, o) && !s.states[o.order_ref].deferredEnRoute);
  const swap = (o: Order) => compatibleSwap(o, vid);
  const last = pending[pending.length - 1];
  // Deliver late where the store can still take it; move only the last stop to a rescue truck;
  // send back chilled goods that would arrive more than an hour after opening.
  const suggest = (o: Order): Choice => {
    const eta = delayedEta(s, o);
    if (!eta?.late) return "late";
    if (o === last && swap(o)) return "move";
    if (o.temp_requirement === "chilled" && eta.over > 60) return "defer";
    return "late";
  };
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  if (!d || !run) return null;
  const pick = (o: Order) => choice[o.order_ref] ?? suggest(o);
  const v = vehicleById.get(vid)!;
  const fuelLeft = Math.max(v.weekly_fuel_quota_l - v.fuel_used_l, 0);
  const idle = (IDLE_L_PER_H * d.minutes) / 60;
  const reason = DELAY_REASONS.find((r) => r.id === d.reason)?.label ?? d.reason;
  const told = !!d.toldAt;

  const confirm = () => {
    const plan: Record<string, Choice> = {};
    const parts: string[] = [];
    let moveTo: string | undefined;
    for (const o of pending) {
      const c = pick(o);
      plan[o.order_ref] = c;
      if (c === "move") moveTo = swap(o);
      const eta = delayedEta(s, o);
      parts.push(c === "late" ? `${o.outlet_id} late (${eta?.from}–${eta?.to})` : c === "move" ? `${o.outlet_id} moved to ${swap(o)}` : `${o.outlet_id} back to the depot, first tomorrow`);
    }
    dispatch({ type: "planDelay", vehicle_id: vid, plan, moveTo, summary: `${vid} delay plan: ${parts.join(", ")}. Stores told on WhatsApp${run.online ? "; driver updated" : "; the driver sees it when signal returns"}.` });
  };

  return (
    <Card className="border-l-4 border-l-hivis p-3">
      <p className="text-xs text-mute">
        {d.at} · {d.via === "sms" ? "SMS from the driver (no data signal)" : "from the driver"}
      </p>
      <p className="mt-1 font-semibold">
        {vid} held up: {reason.toLowerCase()} near {d.near}, about {d.minutes} min
      </p>
      <p className="text-sm text-mute">
        {run.online ? `${run.name ?? "The driver"} is in contact.` : `No data signal since ${run.offlineSince}; decisions reach the phone when it reconnects.`} Chilled goods stay cold while the engine runs: about {idle.toFixed(1)} L extra fuel ({fuelLeft.toFixed(0)} L left this week).
      </p>

      {!!d.smsDone?.length && (
        <p className="mt-2 rounded-md bg-ok-soft px-2 py-1 text-sm text-ok">
          <IconCheck className="mr-1 inline size-4" />
          The SMS also says: {d.smsDone.map((x) => `${s.orders.find((o) => o.order_ref === x.ref)?.outlet_id} delivered at ${x.at}`).join(", ")}. The full record syncs later.
        </p>
      )}
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-mute">
          <tr>
            <th className="py-1 font-medium">Stop</th>
            <th className="py-1 font-medium">New ETA</th>
            <th className="py-1 text-right font-medium">{told ? "Decision" : "Choose"}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const eta = delayedEta(s, o);
            const decided = s.delayPlan[o.order_ref];
            const reply = s.storeReplies[o.order_ref];
            return (
              <tr key={o.order_ref} className="border-t border-line align-top">
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1 font-cond font-semibold">
                    {o.outlet_id} {o.temp_requirement === "chilled" && <span className="text-chill"><IconChill className="size-3.5" /></span>}
                  </span>
                  <span className="block text-xs text-mute">closes {o.window_close_time}</span>
                </td>
                <td className={`py-1.5 pr-2 font-cond ${eta?.late ? "font-semibold text-late" : ""}`}>
                  {eta ? `${eta.from}–${eta.to}` : "—"}
                  {eta?.late && <span className="block font-sans text-xs">after window</span>}
                </td>
                <td className="py-1.5 text-right">
                  {decided ? (
                    <span className="text-xs font-semibold">
                      {decided === "late" ? "Deliver late" : decided === "move" ? `Moved to ${s.states[o.order_ref].reassignedTo ?? "—"}` : "Back to depot"}
                      {reply && <span className={`block ${reply.reply === "wait" ? "text-ok" : "text-late"}`}>{reply.reply === "wait" ? `Store will wait · ${reply.at}` : `Store: send tomorrow · ${reply.at}`}</span>}
                    </span>
                  ) : (
                    <div role="radiogroup" aria-label={`Choice for ${o.outlet_id}`} className="inline-flex flex-col gap-1">
                      {(["late", "move", "defer"] as Choice[])
                        .filter((c) => c !== "move" || swap(o))
                        .map((c) => (
                          <button key={c} role="radio" aria-checked={pick(o) === c} onClick={() => setChoice({ ...choice, [o.order_ref]: c })} className={`h-7 rounded border px-2 text-xs font-semibold ${pick(o) === c ? "border-night bg-night text-white" : "border-line bg-card hover:border-night"}`}>
                            {c === "late" ? "Deliver late" : c === "move" ? `Move to ${swap(o)}` : "Send back"}
                          </button>
                        ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!told ? (
        <>
          <p className="mt-2 text-xs text-mute">Suggested: deliver late and let the store decide (it can reply “send tomorrow”); move only the last stop to a truck that can reach it; send back chilled goods that would arrive more than an hour after opening.</p>
          <Btn variant="primary" className="mt-2 w-full" onClick={confirm} disabled={!pending.length}>
            Confirm and tell the stores
          </Btn>
        </>
      ) : (
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-ok">
          <IconCheck /> Stores told on WhatsApp at {d.toldAt}
        </p>
      )}
      {!told && <Chip tone="hivis" className="mt-2">Late deliveries will be tagged “road disruption”, not the driver</Chip>}
    </Card>
  );
}

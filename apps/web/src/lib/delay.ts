import type { DemoState } from "./store";
import type { Order } from "./types";
import { runFor } from "./runs";
import { tripKey } from "./seed";

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The delay reported on this order's run, if its driver reported one. */
export const delayOn = (s: DemoState, o: Order) => (o.vehicle_id ? runFor(s, tripKey(o))?.delay : undefined);

/** Is this order still to be delivered on a held-up run? */
export function heldUp(s: DemoState, o: Order): boolean {
  const delay = delayOn(s, o);
  if (!delay || delay.smsDone?.some((d) => d.ref === o.order_ref)) return false;
  return o.decision === "served" && !["delivered", "received"].includes(s.states[o.order_ref].stage) && !s.states[o.order_ref].reassignedTo;
}

/** Arrival window pushed back by the reported delay, and whether it now misses the outlet's window. */
export function delayedEta(s: DemoState, o: Order): { from: string; to: string; late: boolean; over: number } | undefined {
  if (!heldUp(s, o) || !o.pred_window) return undefined;
  const mins = delayOn(s, o)!.minutes;
  const [a, b] = o.pred_window.split("-").map(toMin);
  const over = b + mins - toMin(o.window_close_time);
  return { from: fromMin(a + mins), to: fromMin(b + mins), late: over > 0, over };
}

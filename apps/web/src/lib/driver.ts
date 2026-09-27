import type { DemoState } from "./store";
import type { OrderState } from "./types";

/** What the driver's phone shows: shared state plus anything still in its outbox. */
export function driverState(s: DemoState, ref: string): OrderState & { pending: boolean } {
  const base = s.states[ref];
  const evs = s.driver.outbox.filter((e) => e.order_ref === ref);
  let st: OrderState = { ...base };
  for (const e of evs) st = e.type === "arrived" ? { ...st, arrivedAt: e.at } : { ...st, stage: "delivered", deliveredAt: e.at, ...e.payload };
  return { ...st, pending: evs.length > 0 };
}

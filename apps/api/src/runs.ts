/**
 * Driver runs. Each driver account drives one vehicle, and the phone on that vehicle reports for its run:
 * signal, check-ins, delays and synced deliveries are kept per vehicle in `driver_status`.
 */
import type { Account } from "./auth";
import type { Sql, Tx } from "./db";
import type { Day } from "./day";

type Db = Tx | Sql;

/** The vehicle a driver's phone reports for. The seeded demo driver falls back to the day's persona. */
export const vehicleOf = (day: Day, who: Pick<Account, "vehicle_id">) => who.vehicle_id ?? day.meta.personas.driver.vehicle_id;

/** A status row for the vehicle on this day (new driver accounts start without one). */
export async function ensureStatus(tx: Db, dayId: string, vid: string) {
  await tx`INSERT INTO driver_status (workspace_id, vehicle_id) VALUES (${dayId}, ${vid}) ON CONFLICT DO NOTHING`;
}

/**
 * The trip a driver is on: the one set on their account, else the vehicle's first trip that still has
 * stops to deliver, else its last trip of the day.
 */
export function currentTrip(orders: { vehicle_id?: string | null; trip_id?: number | null; decision: string; order_ref: string }[], stage: (ref: string) => string | undefined, vid: string, fixed?: number | null): number {
  if (fixed) return fixed;
  const trips = [...new Set(orders.filter((o) => o.vehicle_id === vid && o.decision === "served").map((o) => o.trip_id!))].sort((a, b) => a - b);
  const open = trips.find((t) => orders.some((o) => o.vehicle_id === vid && o.trip_id === t && o.decision === "served" && !["delivered", "received"].includes(stage(o.order_ref) ?? "")));
  return open ?? trips.at(-1) ?? 1;
}

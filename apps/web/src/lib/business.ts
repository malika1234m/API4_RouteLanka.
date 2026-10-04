import type { Order, Vehicle } from "./types";

/**
 * Money assumptions. These are NOT in the supplied data: they are placeholders a pilot would
 * replace with Waypoint's own figures, and every screen that uses them says so.
 */
export const ASSUME = {
  hireCostPerNight: 45000, // Rs, one hired refrigerated truck with driver
  hireM3: 30, // m³, a typical hired refrigerated truck
  crateValue: 2800, // Rs, average retail value of a chilled crate
  lossShare: 0.18, // share of a deferred chilled crate's value lost (spoilage, empty shelf)
};


export const fmtRs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-LK")}`;

/**
 * Which deferred orders one extra vehicle could carry tonight: one district per trip,
 * orders added smallest first until the vehicle is full. The plan board still checks
 * windows and the Fresh time budget before anything is loaded.
 */
export function bestTrip(pool: Order[], capM3: number, vehicle?: Pick<Vehicle, "type" | "temp">) {
  const byDistrict = new Map<string, Order[]>();
  for (const o of pool) {
    if (vehicle && o.temp_requirement === "chilled" && vehicle.temp !== "reefer") continue;
    if (vehicle && o.parking_constraint === "van_only" && vehicle.type !== "van") continue;
    byDistrict.set(o.district, [...(byDistrict.get(o.district) ?? []), o]);
  }
  let best: { district: string; orders: Order[]; m3: number; crates: number } | undefined;
  for (const [district, os] of byDistrict) {
    const picked: Order[] = [];
    let m3 = 0;
    for (const o of [...os].sort((a, b) => a.order_volume_m3 - b.order_volume_m3)) {
      if (m3 + o.order_volume_m3 <= capM3) {
        picked.push(o);
        m3 += o.order_volume_m3;
      }
    }
    const crates = picked.reduce((a, o) => a + o.order_units, 0);
    if (picked.length && (!best || crates > best.crates)) best = { district, orders: picked, m3, crates };
  }
  return best;
}

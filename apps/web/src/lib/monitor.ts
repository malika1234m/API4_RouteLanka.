import { seed } from "./seed";
import type { Order } from "./types";

/** First other available vehicle at the same depot that could legally carry this order. */
export function compatibleSwap(o: Order, fromVid: string): string | undefined {
  return seed.vehicles.find(
    (v) =>
      v.vehicle_id !== fromVid &&
      v.depot === o.depot &&
      v.status === "available" &&
      (o.temp_requirement !== "chilled" || v.temp === "reefer") &&
      (o.parking_constraint !== "van_only" || v.type === "van"),
  )?.vehicle_id;
}

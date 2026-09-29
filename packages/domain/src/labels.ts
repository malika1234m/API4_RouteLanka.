import type { Order } from "./types";

/** Why an order was deferred, in the dispatcher's words. */
export const REASON_LABEL: Record<string, string> = {
  reefer_capacity: "Refrigerated capacity full",
  reefer_van_capacity: "Refrigerated van full",
  reefer_van_unavailable: "No refrigerated van available",
  van_capacity: "Van capacity full (van-only outlet)",
  time_budget: "No vehicle can reach it within the time window",
  fuel_quota: "Weekly fuel quota reached",
  fleet_capacity: "Larger than any available vehicle",
  dispatcher_choice: "Dispatcher decision",
};

/** What a deferral means for the store, in their words. */
export function deferralConsequence(o: Pick<Order, "temp_requirement" | "brand">): string {
  if (o.temp_requirement === "chilled") return "No chilled delivery tomorrow morning. Dairy, meat and produce move to the next run.";
  if (o.brand === "Style") return "This week's garment delivery moves to the next run.";
  if (o.brand === "Tech") return "Appliance delivery moves to the next run.";
  return "Dry goods move to the next run.";
}

export const DELAY_REASONS = [
  { id: "road_blocked", label: "Road blocked" },
  { id: "slow_traffic", label: "Very slow traffic" },
  { id: "weather", label: "Heavy rain or flooding" },
  { id: "vehicle", label: "Vehicle problem" },
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number]["id"];

export const tripKey = (t: { vehicle_id?: string | null; trip_id?: number | null }) => `${t.vehicle_id}#${t.trip_id}`;

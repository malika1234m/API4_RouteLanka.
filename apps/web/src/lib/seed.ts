import raw from "@/data/seed.json";
import type { Order, Outlet, Seed, Trip, Vehicle } from "./types";

export const seed = raw as unknown as Seed;

export const outletById = new Map<string, Outlet>(seed.outlets.map((o) => [o.outlet_id, o]));
export const vehicleById = new Map<string, Vehicle>(seed.vehicles.map((v) => [v.vehicle_id, v]));
export const districtByName = new Map(seed.districts.map((d) => [d.district, d]));
export const allowanceMin = (brand: string, dock: string) =>
  seed.allowance.find((a) => a.brand === brand && a.dock_type === dock)?.minutes ?? 15;

export const tripKey = (t: { vehicle_id?: string; trip_id?: number }) => `${t.vehicle_id}#${t.trip_id}`;

export const REASON_LABEL: Record<string, string> = {
  reefer_capacity: "Refrigerated capacity full",
  reefer_van_capacity: "Refrigerated van full",
  van_capacity: "Van capacity full (van-only outlet)",
  time_budget: "No vehicle can reach it within the time window",
  fuel_quota: "Weekly fuel quota reached",
  fleet_capacity: "Larger than any available vehicle",
  dispatcher_choice: "Dispatcher decision",
};

/** What a deferral means for the store, in their words. */
export function deferralConsequence(o: Order): string {
  if (o.temp_requirement === "chilled") return "No chilled delivery tomorrow morning. Dairy, meat and produce move to the next run.";
  if (o.brand === "Style") return "This week's garment delivery moves to the next run.";
  if (o.brand === "Tech") return "Appliance delivery moves to the next run.";
  return "Dry goods move to the next run.";
}

export const vehicleLabel = (v?: Vehicle) =>
  v ? `${v.vehicle_id} · ${v.temp === "reefer" ? "refrigerated " : ""}${v.type}` : "";

export function ordersOnTrip(orders: Order[], t: Trip) {
  return t.stops.map((ref) => orders.find((o) => o.order_ref === ref)!).filter(Boolean);
}

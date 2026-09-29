/**
 * The operating constraints from the booklet (Task 2B feasibility rules), as pure functions.
 * The API enforces them on every plan change; the plan board uses the same functions to show,
 * during a drag, which rule a move would break. services/engine/engine.py implements the same
 * rules for the automatic proposal, and both are tested against the organisers' checker.
 */
import type { District, Order, Vehicle } from "./types";

export const FRESH_BUDGET = 270; // minutes, 03:30–08:00
export const DAY_BUDGET = 480; // minutes, Style and Tech trips combined
export const MAX_TRIPS = 2;

/** Reference data the rules need. */
export interface RuleRef {
  district(name: string): District | undefined;
  allowance(brand: string, dock: string): number;
  vehicle(id: string): Vehicle | undefined;
}

export interface TripLoad {
  vehicle_id: string;
  trip_id: number;
  orders: Order[];
  brand?: string;
  district?: string;
  volume: number;
  weight: number;
  minutes: number;
  km: number;
}

/** Outbound travel + travel between stops + handling at each stop. The return leg is already in the budgets. */
export function tripMinutes(ref: RuleRef, district: string, brand: string, docks: string[]): number {
  const d = ref.district(district);
  if (!d || docks.length === 0) return 0;
  return d.depot_to_district_freeflow_min + (docks.length - 1) * d.inter_stop_freeflow_min + docks.reduce((s, k) => s + ref.allowance(brand, k), 0);
}

/** Road distance for fuel: out and back, plus the hops between stops. */
export function tripKm(ref: RuleRef, district: string, stops: number): number {
  const d = ref.district(district);
  if (!d || stops === 0) return 0;
  return 2 * d.depot_to_district_km + (stops - 1) * d.inter_stop_km;
}

export function loadsFor(ref: RuleRef, v: Vehicle, orders: Order[]): TripLoad[] {
  const mine = orders.filter((o) => o.decision === "served" && o.vehicle_id === v.vehicle_id);
  const ids = [...new Set(mine.map((o) => o.trip_id!))].sort();
  return ids.map((trip_id) => {
    const os = mine.filter((o) => o.trip_id === trip_id);
    const brand = os[0]?.brand;
    const district = os[0]?.district;
    return {
      vehicle_id: v.vehicle_id,
      trip_id,
      orders: os,
      brand,
      district,
      volume: os.reduce((s, o) => s + o.order_volume_m3, 0),
      weight: os.reduce((s, o) => s + o.order_weight_kg, 0),
      minutes: brand && district ? tripMinutes(ref, district, brand, os.map((o) => o.dock_type)) : 0,
      km: district ? tripKm(ref, district, os.length) : 0,
    };
  });
}

export interface VehicleUse {
  fresh: number;
  day: number;
  fuel: number;
  fuelLeft: number;
}

export function vehicleUse(v: Vehicle, loads: TripLoad[]): VehicleUse {
  const fresh = loads.filter((l) => l.brand === "Fresh").reduce((s, l) => s + l.minutes, 0);
  const day = loads.filter((l) => l.brand !== "Fresh").reduce((s, l) => s + l.minutes, 0);
  const fuel = loads.reduce((s, l) => s + l.km / v.km_per_l, 0);
  return { fresh, day, fuel, fuelLeft: v.weekly_fuel_quota_l - v.fuel_used_l };
}

/** Every rule a vehicle's trips break, in words a dispatcher understands. Empty means feasible. */
export function violations(ref: RuleRef, v: Vehicle, orders: Order[]): string[] {
  const out: string[] = [];
  const loads = loadsFor(ref, v, orders);
  if (v.status !== "available" && loads.length) out.push(`${v.vehicle_id} is in the workshop`);
  if (loads.length > MAX_TRIPS) out.push(`${loads.length} trips; a vehicle runs at most ${MAX_TRIPS} a day`);
  for (const l of loads) {
    const tag = `Trip ${l.trip_id}`;
    if (new Set(l.orders.map((o) => o.brand)).size > 1) out.push(`${tag} mixes brands (one brand per trip)`);
    if (new Set(l.orders.map((o) => o.district)).size > 1) out.push(`${tag} mixes districts (one district per trip)`);
    if (l.orders.some((o) => o.depot !== v.depot)) out.push(`${tag} carries orders from another depot`);
    if (v.temp !== "reefer" && l.orders.some((o) => o.temp_requirement === "chilled")) out.push(`${tag}: chilled goods need a refrigerated vehicle`);
    if (v.type !== "van" && l.orders.some((o) => o.parking_constraint === "van_only")) out.push(`${tag}: a van-only outlet cannot take a truck`);
    if (l.volume > v.volume_cap_m3 + 1e-6) out.push(`${tag}: ${l.volume.toFixed(1)} m³ exceeds ${v.volume_cap_m3} m³`);
    if (l.weight > v.weight_cap_kg + 1e-6) out.push(`${tag}: ${Math.round(l.weight)} kg exceeds ${v.weight_cap_kg} kg`);
  }
  const u = vehicleUse(v, loads);
  if (u.fresh > FRESH_BUDGET) out.push(`Fresh trips take ${Math.round(u.fresh)} min; the pre-dawn window is ${FRESH_BUDGET}`);
  if (u.day > DAY_BUDGET) out.push(`Style/Tech trips take ${Math.round(u.day)} min; the day window is ${DAY_BUDGET}`);
  if (u.fuel > u.fuelLeft + 1e-6) out.push(`Needs ${u.fuel.toFixed(0)} L; ${u.fuelLeft.toFixed(0)} L of weekly fuel left`);
  return out;
}

/** The violations that moving order `ref` to a vehicle and trip would create. */
export function checkMove(ref: RuleRef, orders: Order[], orderRef: string, vehicle_id: string, trip_id: number): string[] {
  const v = ref.vehicle(vehicle_id);
  if (!v) return [`Unknown vehicle ${vehicle_id}`];
  if (trip_id !== 1 && trip_id !== 2) return [`A vehicle runs trip 1 or trip 2 only`];
  const next = orders.map((o) => (o.order_ref === orderRef ? { ...o, decision: "served" as const, vehicle_id, trip_id } : o));
  return violations(ref, v, next);
}

/** Every violation in a whole plan, prefixed by vehicle. Empty means the plan can be published. */
export function planViolations(ref: RuleRef, vehicles: Vehicle[], orders: Order[]): string[] {
  return vehicles.flatMap((v) => violations(ref, v, orders).map((x) => `${v.vehicle_id}: ${x}`));
}

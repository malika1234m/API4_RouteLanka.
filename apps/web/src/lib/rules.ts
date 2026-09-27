/** Hard operating constraints, mirrored from the booklet and scripts/engine.py. */
import { allowanceMin, districtByName, seed } from "./seed";
import type { Order, Vehicle } from "./types";

export const FRESH_BUDGET = 270;
export const DAY_BUDGET = 480;
export const MAX_TRIPS = 2;

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

export function tripMinutes(district: string, brand: string, docks: string[]) {
  const d = districtByName.get(district);
  if (!d || docks.length === 0) return 0;
  return d.depot_to_district_freeflow_min + (docks.length - 1) * d.inter_stop_freeflow_min + docks.reduce((s, k) => s + allowanceMin(brand, k), 0);
}

export function tripKm(district: string, n: number) {
  const d = districtByName.get(district);
  if (!d || n === 0) return 0;
  return 2 * d.depot_to_district_km + (n - 1) * d.inter_stop_km;
}

export function loadsFor(v: Vehicle, orders: Order[]): TripLoad[] {
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
      minutes: brand && district ? tripMinutes(district, brand, os.map((o) => o.dock_type)) : 0,
      km: district ? tripKm(district, os.length) : 0,
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

/** Every rule a vehicle's trips break. Empty = feasible. */
export function violations(v: Vehicle, orders: Order[]): string[] {
  const out: string[] = [];
  const loads = loadsFor(v, orders);
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

/** Would moving order `ref` to vehicle/trip break a rule? Returns the violations it would create. */
export function checkMove(orders: Order[], ref: string, vehicle_id: string, trip_id: number): string[] {
  const v = seed.vehicles.find((x) => x.vehicle_id === vehicle_id)!;
  const next = orders.map((o) => (o.order_ref === ref ? { ...o, decision: "served" as const, vehicle_id, trip_id } : o));
  return violations(v, next);
}

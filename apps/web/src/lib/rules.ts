/**
 * The operating rules, from the shared domain package: the same functions the API uses to accept or
 * refuse a plan change. Here they drive the plan board's live feedback while dragging.
 */
import * as R from "@routelanka/domain";
import type { Order, Vehicle } from "@routelanka/domain";
import { allowanceMin, districtByName, vehicleById } from "./seed";

export { DAY_BUDGET, FRESH_BUDGET, MAX_TRIPS, type TripLoad, type VehicleUse } from "@routelanka/domain";

const ref: R.RuleRef = {
  district: (n) => districtByName.get(n),
  allowance: allowanceMin,
  vehicle: (id) => vehicleById.get(id),
};

export const tripMinutes = (district: string, brand: string, docks: string[]) => R.tripMinutes(ref, district, brand, docks);
export const tripKm = (district: string, n: number) => R.tripKm(ref, district, n);
export const loadsFor = (v: Vehicle, orders: Order[]) => R.loadsFor(ref, v, orders);
export const vehicleUse = R.vehicleUse;
export const violations = (v: Vehicle, orders: Order[]) => R.violations(ref, v, orders);
export const checkMove = (orders: Order[], orderRef: string, vehicle_id: string, trip_id: number) => R.checkMove(ref, orders, orderRef, vehicle_id, trip_id);

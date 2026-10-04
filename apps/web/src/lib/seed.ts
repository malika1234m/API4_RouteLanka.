/**
 * Reference data and the day's plan, loaded from the API. Screens read it through `seed` and the
 * lookups below; `setSeed` refreshes it whenever the day's view is fetched. It starts with the seeded
 * demo day's personas so modules that read them at import time have values before the first fetch.
 */
import type { DayMeta, DayView, District, Order, Outlet, OutletHistory, OutlookWeek, Personas, Reference, Trip, Vehicle } from "@routelanka/domain";
export { REASON_LABEL, deferralConsequence, tripKey } from "@routelanka/domain";

export interface SeedData {
  meta: DayMeta & { date: string };
  /** The next two operating nights after this one. */
  next_runs: string[];
  personas: Personas;
  /** The people signed in on this browser. */
  me: DayView["me"];
  outlets: Outlet[];
  vehicles: Vehicle[];
  districts: District[];
  allowance: { brand: string; dock_type: string; minutes: number }[];
  orders: Order[];
  trips: Trip[];
  outlook: OutlookWeek[];
  outlet_history: Record<string, OutletHistory>;
  road_today: Record<string, number>;
}

const PERSONAS: Personas = {
  dispatcher: { name: "Gehiru", depot: "Peliyagoda" },
  loader: { name: "Senash", depot: "Kandy" },
  driver: { name: "Nimsith", vehicle_id: "VEH041", trip_id: 1 },
  store: { name: "Malika", outlet_id: "OUT029" },
};

export const seed: SeedData = {
  meta: { date: "2026-04-24", dow: "Friday", festival: "Vesak", festival_date: "2026-05-01", cutoff: "16:00", fresh_budget: 270, day_budget: 480, monsoon: 1, personas: PERSONAS },
  personas: PERSONAS,
  next_runs: ["2026-04-25", "2026-04-27"],
  me: {},
  outlets: [],
  vehicles: [],
  districts: [],
  allowance: [],
  orders: [],
  trips: [],
  outlook: [],
  outlet_history: {},
  road_today: {},
};

/** Map-like lookups over the current data, so screens can keep using `.get` and `.has`. */
const lookup = <T>(list: () => T[], key: (x: T) => string) => ({
  get: (k: string) => list().find((x) => key(x) === k),
  has: (k: string) => list().some((x) => key(x) === k),
});
export const outletById = lookup(() => seed.outlets, (o) => o.outlet_id);
export const vehicleById = lookup(() => seed.vehicles, (v) => v.vehicle_id);
export const districtByName = lookup(() => seed.districts, (d) => d.district);
export const allowanceMin = (brand: string, dock: string) => seed.allowance.find((a) => a.brand === brand && a.dock_type === dock)?.minutes ?? 15;

export function setReference(r: Reference) {
  Object.assign(seed, { outlets: r.outlets, districts: r.districts, allowance: r.allowance, outlook: r.outlook, outlet_history: r.outlet_history, road_today: r.road_today });
  if (!seed.vehicles.length) seed.vehicles = r.vehicles.map((v) => ({ ...v, status: "available", fuel_used_l: 0 }) as Vehicle);
}

export function setDay(v: DayView) {
  seed.meta = { ...v.day.meta, date: v.day.service_date };
  seed.next_runs = v.day.next_runs?.length ? v.day.next_runs : seed.next_runs;
  // Each signed-in person's own name and work (their store, depot or vehicle) replace the demo persona's,
  // so every screen opens on what that person covers.
  const p = v.day.meta.personas;
  const me = v.me ?? {};
  seed.me = me;
  seed.personas = {
    dispatcher: { ...p.dispatcher, ...pick(me.dispatcher, "name", "depot") },
    loader: { ...p.loader, ...pick(me.loader, "name", "depot") },
    driver: { ...p.driver, ...pick(me.driver, "name", "vehicle_id", "trip_id") },
    store: { ...p.store, ...pick(me.store, "name", "outlet_id") },
  };
  seed.vehicles = v.vehicles;
  seed.trips = v.trips;
  seed.orders = v.orders;
}

const pick = <T extends object, K extends keyof T>(o: T | undefined, ...keys: K[]): Partial<Pick<T, K>> =>
  o ? (Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as Partial<Pick<T, K>>) : {};

export const vehicleLabel = (v?: Vehicle) => (v ? `${v.vehicle_id} · ${v.temp === "reefer" ? "refrigerated " : ""}${v.type}` : "");

export function ordersOnTrip(orders: Order[], t: Trip) {
  return t.stops.map((ref) => orders.find((o) => o.order_ref === ref)!).filter(Boolean);
}

/**
 * Read side: builds the view model a screen needs for one demo day from the normalised tables.
 * Role-specific secrets are added only for the role that may see them (store handover codes, and
 * the driver's hashes for checking those codes offline).
 */
import { codeHash, type DayView, type DriverView, type Person, type FeedItem, type Lang, type Order, type OrderState, type Reference, type Role, type Trip, type Vehicle } from "@routelanka/domain";
import { sql } from "./db";
import { coversStore, type Account } from "./auth";
import type { Day } from "./day";
import { currentTrip } from "./runs";

const ORDER_COLS = sql`o.order_ref, o.outlet_id, o.brand, o.district, o.depot, t.dock_type, t.parking_constraint, t.mall_window,
  t.window_open_time, t.window_close_time, o.temp_requirement, o.order_units, o.order_weight_kg, o.order_volume_m3,
  o.deferred_yesterday, o.days_since_last_served`;

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

export async function buildView(day: Day, role?: Role, signedIn: Account[] = []): Promise<DayView> {
  const ws = day.id;
  const ids = signedIn.map((a) => a.uid);
  const [orders, placed, progress, trips, vehicles, feed, driverRows, driverUsers, prefs, fleet, jobs, nextRuns] = await Promise.all([
    sql<Order[]>`SELECT ${ORDER_COLS}, a.decision, a.reason, a.vehicle_id, a.trip_id, a.stop_seq, a.plan_arrival, a.pred_arrival,
                        a.pred_window, a.pred_service_min, a.pred_late_prob, a.priority
                 FROM orders o JOIN outlets t USING (outlet_id) JOIN assignments a ON a.workspace_id = o.workspace_id AND a.order_ref = o.order_ref
                 WHERE o.workspace_id = ${ws} AND o.run_date = ${day.service_date}::date ORDER BY o.order_ref`,
    sql<Order[]>`SELECT ${ORDER_COLS}, 'served' AS decision, 0 AS priority
                 FROM orders o JOIN outlets t USING (outlet_id)
                 WHERE o.workspace_id = ${ws} AND o.run_date <> ${day.service_date}::date ORDER BY o.placed_at DESC NULLS LAST, o.order_ref`,
    sql`SELECT * FROM order_progress WHERE workspace_id = ${ws}`,
    sql<(Trip & { ready_at: string | null; departed_at: string | null })[]>`SELECT * FROM trips WHERE workspace_id = ${ws} ORDER BY vehicle_id, trip_id`,
    sql<Vehicle[]>`SELECT v.vehicle_id, v.type, v.temp, v.weight_cap_kg, v.volume_cap_m3, v.km_per_l, v.weekly_fuel_quota_l, v.depot, d.status, d.fuel_used_l
                   FROM vehicles v JOIN vehicle_day d USING (vehicle_id) WHERE d.workspace_id = ${ws} ORDER BY v.vehicle_id`,
    sql<FeedItem[]>`SELECT id, at, actor_role AS role, kind, text, order_ref AS ref, open FROM events
                    WHERE workspace_id = ${ws} AND in_feed ORDER BY seq DESC LIMIT 60`,
    sql`SELECT * FROM driver_status WHERE workspace_id = ${ws}`,
    sql<{ display_name: string; vehicle_id: string; trip_id: number | null }[]>`SELECT display_name, vehicle_id, trip_id FROM users WHERE role = 'driver' AND active ORDER BY vehicle_id`,
    // Each role's language: the person signed in on this browser, else the first account in that role.
    sql<{ role: Role; lang: Lang }[]>`SELECT DISTINCT ON (role) role, lang FROM users ORDER BY role, (id = ANY(${ids}::uuid[])) DESC, created_at`,
    sql`SELECT * FROM fleet_actions WHERE workspace_id = ${ws} ORDER BY at`,
    sql`SELECT id, status, summary, error FROM plan_jobs WHERE workspace_id = ${ws} ORDER BY requested_at DESC LIMIT 1`,
    sql<{ d: string }[]>`SELECT date::text AS d FROM calendar WHERE is_operating AND date > ${day.service_date}::date ORDER BY date LIMIT 2`,
  ]);

  const states: Record<string, OrderState> = {};
  const delayPlan: DayView["delayPlan"] = {};
  const storeReplies: DayView["storeReplies"] = {};
  const acks: DayView["acks"] = {};
  const codes: Record<string, string> = {};
  for (const p of progress) {
    states[p.order_ref] = clean({
      stage: p.stage,
      deferred: p.deferred,
      loadFlag: p.load_flag,
      loadDecision: p.load_decision,
      arrivedAt: p.arrived_at,
      deliveredAt: p.delivered_at,
      deliveredUnits: p.delivered_units,
      exception: p.exception,
      pod: p.pod,
      recordedOffline: p.recorded_offline || undefined,
      syncedAt: p.synced_at,
      receipt: p.receipt,
      reassignedTo: p.reassigned_to,
      deferredEnRoute: p.deferred_en_route,
    }) as OrderState;
    if (p.delay_choice) delayPlan[p.order_ref] = p.delay_choice;
    if (p.store_reply) storeReplies[p.order_ref] = p.store_reply;
    if (p.ack_at) acks[p.order_ref] = p.ack_at;
    if (p.handover_code) codes[p.order_ref] = p.handover_code;
  }

  const stops = new Map<string, string[]>();
  for (const o of [...orders].sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0))) {
    if (o.decision !== "served") continue;
    const k = `${o.vehicle_id}#${o.trip_id}`;
    stops.set(k, [...(stops.get(k) ?? []), o.order_ref]);
  }
  const byRef = new Map(orders.map((o) => [o.order_ref, o]));
  const sum = (refs: string[], f: (o: Order) => number) => Math.round(refs.reduce((n, r) => n + Number(f(byRef.get(r)!)), 0) * 1000) / 1000;
  const ready: Record<string, boolean> = {};
  const departed: Record<string, string> = {};
  const tripsOut: Trip[] = trips.map((t) => {
    const k = `${t.vehicle_id}#${t.trip_id}`;
    if (t.ready_at) ready[k] = true;
    if (t.departed_at) departed[k] = t.departed_at;
    const refs = stops.get(k) ?? [];
    return {
      vehicle_id: t.vehicle_id, trip_id: t.trip_id, brand: t.brand, district: t.district, depot: t.depot, stops: refs, depart: t.depart, minutes: t.minutes,
      volume_m3: sum(refs, (o) => o.order_volume_m3), weight_kg: sum(refs, (o) => o.order_weight_kg), km: t.km, fuel_l: t.fuel_l,
    };
  });

  // Driver runs: one per vehicle with a driver's phone on it.
  const stageOf = (ref: string) => states[ref]?.stage;
  const statusOf = new Map(driverRows.map((r) => [r.vehicle_id as string, r]));
  const runOf = (vid: string, fixedTrip: number | null | undefined, name?: string): DriverView => {
    const d = statusOf.get(vid);
    return clean({
      vehicle_id: vid,
      trip_id: currentTrip(orders, stageOf, vid, fixedTrip),
      name,
      online: d?.online ?? true,
      offlineSince: d?.offline_since,
      lastContact: d?.last_contact,
      lastContactStop: d?.last_contact_stop,
      conflicts: d?.conflicts ?? [],
      lastSync: d?.last_sync,
      delay: d?.delay,
    }) as DriverView;
  };
  const persona = day.meta.personas.driver;
  const drivers = driverUsers.map((u) => runOf(u.vehicle_id, u.trip_id, u.display_name));
  if (!drivers.some((r) => r.vehicle_id === persona.vehicle_id)) drivers.unshift(runOf(persona.vehicle_id, persona.trip_id, persona.name));
  const meDriver = signedIn.find((a) => a.role === "driver");
  const driver = (meDriver?.vehicle_id && drivers.find((r) => r.vehicle_id === meDriver.vehicle_id)) || drivers.find((r) => r.vehicle_id === persona.vehicle_id)!;
  const me: DayView["me"] = {};
  for (const a of signedIn) {
    const p: Person = { name: a.name, username: a.username, depot: a.depot, outlet_id: a.outlet_id, district: a.district, vehicle_id: a.vehicle_id, trip_id: a.role === "driver" ? driver.trip_id : a.trip_id, demo: a.demo };
    me[a.role] = clean(p);
  }
  const lang = { dispatcher: "en", loader: "en", driver: "en", store: "en" } as DayView["lang"];
  for (const p of prefs) lang[p.role] = p.lang;
  const job = jobs[0];

  const view: DayView = {
    day: { id: day.id, name: day.name, service_date: day.service_date, // While the plan is unpublished the clock holds at 03:00 (the client shows that), so the view sends a fixed
    // start: an unchanged day then gives an identical view, and a refetch costs a 304.
    clock_start: day.published ? new Date(day.clock_start).getTime() : 0, clock_speed: day.clock_speed, meta: day.meta, next_runs: nextRuns.map((r) => r.d) },
    published: day.published,
    planVersion: day.plan_version,
    planChangedAt: day.plan_changed_at ?? undefined,
    orders: orders.map(clean),
    states,
    trips: tripsOut,
    vehicles,
    ready,
    departed,
    feed: feed.map((f) => clean({ ...f, open: f.open || undefined })),
    driver,
    drivers,
    me,
    delayPlan,
    delayToldAt: day.delay_told_at ?? undefined,
    storeReplies,
    acks,
    placed: placed.map(clean),
    lang,
    fleet: {
      repairs: fleet.filter((f) => f.kind === "repair").map((f) => f.vehicle_id),
      hires: fleet.filter((f) => f.kind === "hire").map((f) => ({ id: f.id, at: f.at, district: f.district, m3: f.m3, cost: f.cost })),
    },
    planJob: job ? clean({ id: job.id, status: job.status, summary: job.summary, error: job.error }) : undefined,
  };
  if (role === "store") {
    // A store manager sees the codes for their own store (an area manager, their district's stores).
    const store = signedIn.find((a) => a.role === "store");
    view.codes = store ? Object.fromEntries(Object.entries(codes).filter(([ref]) => coversStore(store, byRef.get(ref) ?? {}))) : {};
  }
  if (role === "driver") {
    const onRun = orders.filter((o) => o.vehicle_id === driver.vehicle_id && o.trip_id === driver.trip_id);
    view.codeHashes = Object.fromEntries(onRun.filter((o) => codes[o.order_ref]).map((o) => [o.order_ref, codeHash(o.order_ref, codes[o.order_ref])]));
  }
  return view;
}

export async function buildReference(day: Day): Promise<Reference> {
  const [outlets, vehicles, districts, allowance, outlook, history, roads] = await Promise.all([
    sql`SELECT * FROM outlets ORDER BY outlet_id`,
    sql`SELECT * FROM vehicles ORDER BY vehicle_id`,
    sql`SELECT * FROM districts ORDER BY district`,
    sql`SELECT brand, dock_type, minutes FROM service_allowance`,
    sql`SELECT depot, iso_week, total, chilled, chilled_capacity, operating_days, festival, paydays FROM capacity_outlook ORDER BY depot DESC, iso_week`,
    sql<{ outlet_id: string; summary: unknown }[]>`SELECT outlet_id, summary FROM outlet_history`,
    sql<{ district: string; disruption_index: number }[]>`SELECT district, disruption_index FROM road_conditions WHERE date = ${day.service_date}::date`,
  ]);
  return {
    outlets: outlets as never,
    vehicles: vehicles as never,
    districts: districts as never,
    allowance: allowance as never,
    outlook: outlook as never,
    outlet_history: Object.fromEntries(history.map((h) => [h.outlet_id, h.summary])) as never,
    road_today: Object.fromEntries(roads.map((r) => [r.district, r.disruption_index])),
  };
}

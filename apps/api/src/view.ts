/**
 * Read side: builds the view model a screen needs for one demo day from the normalised tables.
 * Role-specific secrets are added only for the role that may see them (store handover codes, and
 * the driver's hashes for checking those codes offline).
 */
import { codeHash, type DayView, type FeedItem, type Lang, type Order, type OrderState, type Reference, type Role, type Trip, type Vehicle } from "@routelanka/domain";
import { sql } from "./db";
import type { Day } from "./day";

const ORDER_COLS = sql`o.order_ref, o.outlet_id, o.brand, o.district, o.depot, t.dock_type, t.parking_constraint, t.mall_window,
  t.window_open_time, t.window_close_time, o.temp_requirement, o.order_units, o.order_weight_kg, o.order_volume_m3,
  o.deferred_yesterday, o.days_since_last_served`;

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

export async function buildView(day: Day, role?: Role): Promise<DayView> {
  const ws = day.id;
  const [orders, placed, progress, trips, vehicles, feed, driverRows, prefs, fleet, jobs] = await Promise.all([
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
    sql`SELECT * FROM driver_status WHERE workspace_id = ${ws} AND vehicle_id = ${day.meta.personas.driver.vehicle_id}`,
    sql<{ role: Role; lang: Lang }[]>`SELECT role, lang FROM user_prefs WHERE workspace_id = ${ws}`,
    sql`SELECT * FROM fleet_actions WHERE workspace_id = ${ws} ORDER BY at`,
    sql`SELECT id, status, summary, error FROM plan_jobs WHERE workspace_id = ${ws} ORDER BY requested_at DESC LIMIT 1`,
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
  const ready: Record<string, boolean> = {};
  const departed: Record<string, string> = {};
  const tripsOut: Trip[] = trips.map((t) => {
    const k = `${t.vehicle_id}#${t.trip_id}`;
    if (t.ready_at) ready[k] = true;
    if (t.departed_at) departed[k] = t.departed_at;
    return { vehicle_id: t.vehicle_id, trip_id: t.trip_id, brand: t.brand, district: t.district, depot: t.depot, stops: stops.get(k) ?? [], depart: t.depart, minutes: t.minutes, volume_m3: 0, weight_kg: 0, km: t.km, fuel_l: t.fuel_l };
  });

  const d = driverRows[0];
  const persona = day.meta.personas.driver;
  const lang = { dispatcher: "en", loader: "en", driver: "en", store: "en" } as DayView["lang"];
  for (const p of prefs) lang[p.role] = p.lang;
  const job = jobs[0];

  const view: DayView = {
    day: { id: day.id, name: day.name, service_date: day.service_date, clock_start: new Date(day.clock_start).getTime(), clock_speed: day.clock_speed, meta: day.meta },
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
    driver: clean({
      vehicle_id: persona.vehicle_id,
      trip_id: persona.trip_id,
      online: d?.online ?? true,
      offlineSince: d?.offline_since,
      lastContact: d?.last_contact,
      lastContactStop: d?.last_contact_stop,
      conflicts: d?.conflicts ?? [],
      lastSync: d?.last_sync,
      delay: d?.delay,
    }),
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
  if (role === "store") view.codes = codes;
  if (role === "driver") {
    const onRun = orders.filter((o) => o.vehicle_id === persona.vehicle_id && o.trip_id === persona.trip_id);
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

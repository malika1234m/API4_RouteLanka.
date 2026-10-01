/**
 * Demo days and their clocks. Each request works on one demo day: the browser's `rl_day` cookie, or
 * the default day. A day's clock reads 03:00 at `clock_start` and runs `clock_speed` times real time.
 */
import { clockStartFor, clockTime, toMin, type DayMeta } from "@routelanka/domain";
import type { FastifyRequest } from "fastify";
import { HttpError } from "./auth";
import { sql, type Sql, type Tx } from "./db";

export interface Day {
  id: string;
  name: string;
  service_date: string;
  clock_start: Date;
  clock_speed: number;
  published: boolean;
  plan_version: number;
  plan_changed_at: string | null;
  delay_told_at: string | null;
  meta: DayMeta;
}

/** Until the plan is published the night hasn't started: the clock holds at 03:00. */
const held = (d: Day | undefined): Day | undefined => (d && !d.published ? { ...d, clock_start: new Date() } : d);

export async function loadDay(db: Sql | Tx, id?: string): Promise<Day | undefined> {
  const rows = id
    ? await db<Day[]>`SELECT id, name, service_date::text, clock_start, clock_speed, published, plan_version, plan_changed_at, delay_told_at, meta FROM workspaces WHERE id = ${id} AND NOT is_template`
    : [];
  if (rows[0]) return held(rows[0]);
  const def = await db<Day[]>`SELECT id, name, service_date::text, clock_start, clock_speed, published, plan_version, plan_changed_at, delay_told_at, meta FROM workspaces WHERE is_default`;
  return held(def[0]);
}

/** Lock the day's row for the rest of the transaction, so concurrent commands on one day apply in order. */
export async function lockDay(tx: Tx, id: string): Promise<Day> {
  const [d] = await tx<Day[]>`SELECT id, name, service_date::text, clock_start, clock_speed, published, plan_version, plan_changed_at, delay_told_at, meta FROM workspaces WHERE id = ${id} FOR UPDATE`;
  if (!d) throw new Error("demo day not found");
  return held(d)!;
}

export const now = (d: Pick<Day, "clock_start" | "clock_speed">) => clockTime(new Date(d.clock_start).getTime(), d.clock_speed);

/** Move the day's clock forward to `hhmm` (never back). Used when a truck leaves or a driver arrives. */
export async function skipTo(tx: Tx, d: Day, hhmm?: string | null): Promise<Day> {
  if (!hhmm) return d;
  if (toMin(hhmm) <= toMin(now(d))) return d;
  const start = new Date(clockStartFor(hhmm, d.clock_speed));
  await tx`UPDATE workspaces SET clock_start = ${start} WHERE id = ${d.id}`;
  return { ...d, clock_start: start };
}

export async function createDay(db: Sql, name: string): Promise<string> {
  return db.begin(async (tx) => {
    // Housekeeping: copies of the night older than three days are no longer anyone's walkthrough. A browser
    // still pointing at one falls back to the default day.
    await tx`DELETE FROM workspaces WHERE NOT is_default AND NOT is_template AND created_at < now() - interval '3 days'`;
    const [r] = await tx<{ id: string }[]>`SELECT clone_template_day(${name}) AS id`;
    await tx`INSERT INTO events (workspace_id, type, actor_role, text, at, in_feed) VALUES (${r.id}, 'day.created', 'dispatcher', ${`Demo day created: ${name}`}, '03:00', false)`;
    return r.id;
  });
}

export const DAY_COOKIE = "rl_day";

/** The demo day this browser is on (its cookie), or the default day. */
export async function currentDay(req: FastifyRequest) {
  const day = await loadDay(sql, req.cookies[DAY_COOKIE]);
  if (!day) throw new HttpError(503, "No demo day yet: the seed job hasn't run.");
  return day;
}

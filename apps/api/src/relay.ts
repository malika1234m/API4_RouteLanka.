/**
 * Transactional outbox relay. Publishes events the API (or a worker) has committed to the `events`
 * table, and planning requests from `plan_jobs`, to RabbitMQ.
 *
 * - Woken by Postgres NOTIFY on insert, with a slow poll as a safety net.
 * - Rows are claimed with FOR UPDATE SKIP LOCKED, so several API instances can run the relay safely.
 * - A row is marked published only after the broker confirms it. If RabbitMQ is down, rows wait and
 *   are sent in order when it comes back: at-least-once delivery. Consumers are idempotent.
 */
import { sql } from "./db";
import { COMMANDS, EVENTS, publish } from "./mq";

let running = false;
let again = false;

async function drain() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await sql.begin(async (tx) => {
        const rows = await tx<{ id: string; seq: string; workspace_id: string; type: string; actor_role: string; order_ref: string | null; payload: unknown; at: string; text: string; kind: string; open: boolean }[]>`
          SELECT id, seq, workspace_id, type, actor_role, order_ref, payload, at, text, kind, open FROM events
          WHERE published_at IS NULL ORDER BY seq LIMIT 100 FOR UPDATE SKIP LOCKED`;
        for (const e of rows) {
          await publish(EVENTS, e.type, e, { workspace: e.workspace_id }, e.id);
          await tx`UPDATE events SET published_at = now() WHERE id = ${e.id}`;
        }
        if (rows.length === 100) again = true;

        const jobs = await tx<{ id: string; workspace_id: string }[]>`
          SELECT id, workspace_id FROM plan_jobs WHERE dispatched_at IS NULL AND status = 'queued' FOR UPDATE SKIP LOCKED`;
        for (const j of jobs) {
          await publish(COMMANDS, "plan.propose", { job_id: j.id, workspace_id: j.workspace_id }, { workspace: j.workspace_id }, j.id);
          await tx`UPDATE plan_jobs SET dispatched_at = now() WHERE id = ${j.id}`;
        }
      });
    } while (again);
  } catch (e) {
    console.error("[relay] publish failed; will retry", (e as Error).message);
  } finally {
    running = false;
  }
}

export async function startRelay() {
  await sql.listen("outbox", () => void drain());
  setInterval(() => void drain(), 2000);
  await drain();
}

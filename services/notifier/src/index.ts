/**
 * Notifier worker: turns domain events into the store's WhatsApp messages.
 *
 * It owns no business rules; it only reacts. If it is slow or down, planning and delivery carry on and
 * the messages catch up from its durable queue. Each event is handled once: the event id is recorded in
 * processed_messages in the same transaction as the messages it writes.
 *
 * The WhatsApp gateway is simulated: messages are stored and shown in the store's Messages screen.
 * A production deployment would add a sender that posts each new row to the WhatsApp Business API.
 */
import amqp from "amqplib";
import postgres from "postgres";
import { DELAY_REASONS, fromMin, toMin } from "@routelanka/domain";
import * as T from "./templates";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://routelanka:routelanka@localhost:5433/routelanka", {
  max: 4,
  types: { numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
  onnotice: () => {},
});
type Tx = postgres.TransactionSql;
const RABBIT = process.env.RABBITMQ_URL ?? "amqp://routelanka:routelanka@localhost:5672/";
const QUEUE = "notifier.events";
const KEYS = ["day.created", "order.placed", "plan.published", "load.decided", "trip.departed", "delay.planned", "store.replied", "store.acknowledged", "stop.delivered", "receipt.confirmed"];

interface Event {
  id: string;
  workspace_id: string;
  type: string;
  order_ref: string | null;
  payload: Record<string, unknown>;
  at: string;
}

async function orders(tx: Tx, ws: string, refs?: string[]): Promise<T.OrderRow[]> {
  return tx<T.OrderRow[]>`
    SELECT o.order_ref, o.outlet_id, o.brand, o.temp_requirement, o.order_units, a.decision, a.reason, a.vehicle_id, a.pred_window,
           a.pred_late_prob, t.window_close_time, p.handover_code, p.reassigned_to, p.load_flag
    FROM orders o JOIN outlets t USING (outlet_id)
    LEFT JOIN assignments a ON a.workspace_id = o.workspace_id AND a.order_ref = o.order_ref
    LEFT JOIN order_progress p ON p.workspace_id = o.workspace_id AND p.order_ref = o.order_ref
    WHERE o.workspace_id = ${ws} ${refs ? tx`AND o.order_ref = ANY(${refs})` : tx``}`;
}

async function write(tx: Tx, e: Event, msgs: T.Msg[]) {
  for (const m of msgs) {
    await tx`INSERT INTO messages (workspace_id, source_event, channel, outlet_id, order_ref, direction, template, vars, replies, day, at)
             VALUES (${e.workspace_id}, ${e.id}, 'whatsapp', ${m.outlet_id}, ${m.order_ref}, ${m.direction ?? "in"}, ${m.template},
                     ${tx.json((m.vars ?? {}) as never)}, ${m.replies ? tx.json(m.replies as never) : null}, ${m.day ?? "Today"}, ${m.at ?? e.at})
             ON CONFLICT (source_event, order_ref, template) DO NOTHING`;
  }
}

async function handle(tx: Tx, e: Event) {
  const one = async () => (await orders(tx, e.workspace_id, [e.order_ref!]))[0];
  switch (e.type) {
    case "day.created": {
      // Receipts for the orders placed before the cutoff (the seeded day's orders came in yesterday).
      const [d] = await tx<{ service_date: string }[]>`SELECT service_date::text FROM workspaces WHERE id = ${e.workspace_id}`;
      const os = await tx<T.OrderRow[]>`SELECT o.order_ref, o.outlet_id, o.brand, o.temp_requirement, o.order_units FROM orders o WHERE workspace_id = ${e.workspace_id} AND run_date = ${d.service_date}::date`;
      return write(tx, e, os.map((o) => T.received(o, "Yesterday", "Friday 24 April", "15:12")));
    }
    case "order.placed":
      return write(tx, e, [T.received(await one(), "Today", "Saturday 25 April", e.at)]);
    case "plan.published": {
      if (e.payload.republish) return; // stores already have their messages; changes are sent by the events that make them
      const [d] = await tx<{ service_date: string }[]>`SELECT service_date::text FROM workspaces WHERE id = ${e.workspace_id}`;
      const os = (await orders(tx, e.workspace_id)).filter((o) => o.decision);
      void d;
      return write(tx, e, os.flatMap(T.published));
    }
    case "load.decided":
      if (e.payload.decision === "send_short") return write(tx, e, [T.sentShort(await one())]);
      return;
    case "trip.departed": {
      const os = await orders(tx, e.workspace_id, e.payload.orders as string[]);
      return write(tx, e, os.map((o) => T.departed(o, e.at)));
    }
    case "delay.planned": {
      const plan = e.payload.plan as Record<string, "late" | "move" | "defer">;
      const [ds] = await tx<{ delay: { minutes: number; reason: string } | null }[]>`
        SELECT d.delay FROM driver_status d JOIN workspaces w ON w.id = d.workspace_id AND d.vehicle_id = w.meta->'personas'->'driver'->>'vehicle_id'
        WHERE d.workspace_id = ${e.workspace_id}`;
      const mins = ds?.delay?.minutes ?? 0;
      const why = (DELAY_REASONS.find((r) => r.id === ds?.delay?.reason)?.label ?? "Road disruption").toLowerCase();
      const os = await orders(tx, e.workspace_id, Object.keys(plan));
      return write(
        tx,
        e,
        os.map((o) => {
          const [a, b] = (o.pred_window ?? "").split("-");
          const eta = a && b ? { from: fromMin(toMin(a) + mins), to: fromMin(toMin(b) + mins), late: toMin(b) + mins > toMin(o.window_close_time) } : null;
          return T.delayNotice(o, plan[o.order_ref], why, eta);
        }),
      );
    }
    case "store.replied":
      return write(tx, e, T.storeReplied(await one(), e.payload.reply as "wait" | "tomorrow", e.at));
    case "store.acknowledged":
      if (e.payload.via === "whatsapp" || e.payload.via === "app") return write(tx, e, [T.acknowledged(await one(), e.at)]);
      return;
    case "stop.delivered": {
      const pod = e.payload.pod as { method: string } | null;
      const [p] = await tx<{ pod: { name?: string } | null; synced_at: string | null }[]>`SELECT pod, synced_at FROM order_progress WHERE workspace_id = ${e.workspace_id} AND order_ref = ${e.order_ref}`;
      const msg = T.delivered(await one(), { units: e.payload.units as number | null, method: pod?.method ?? null, name: p?.pod?.name, deliveredAt: e.at });
      // Recorded offline: the store hears when the record reaches the server.
      return write(tx, e, [{ ...msg, at: p?.synced_at ?? e.at }]);
    }
    case "receipt.confirmed":
      return write(tx, e, T.receipt(await one(), !!e.payload.ok, e.payload as never, e.at));
  }
}

async function main() {
  for (;;) {
    try {
      const conn = await amqp.connect(RABBIT);
      const ch = await conn.createChannel();
      await ch.assertExchange("routelanka.events", "topic", { durable: true });
      await ch.assertExchange("routelanka.dlx", "topic", { durable: true });
      await ch.assertQueue(QUEUE, { durable: true, arguments: { "x-dead-letter-exchange": "routelanka.dlx", "x-dead-letter-routing-key": `${QUEUE}.dead` } });
      await ch.assertQueue(`${QUEUE}.dead`, { durable: true });
      await ch.bindQueue(`${QUEUE}.dead`, "routelanka.dlx", `${QUEUE}.dead`);
      for (const k of KEYS) await ch.bindQueue(QUEUE, "routelanka.events", k);
      await ch.prefetch(10);
      await ch.consume(QUEUE, async (msg) => {
        if (!msg) return;
        try {
          const e = JSON.parse(msg.content.toString()) as Event;
          await sql.begin(async (tx) => {
            const [fresh] = await tx`INSERT INTO processed_messages (consumer, event_id) VALUES ('notifier', ${e.id}) ON CONFLICT DO NOTHING RETURNING 1`;
            if (fresh) await handle(tx, e);
          });
          ch.ack(msg);
        } catch (err) {
          console.error("[notifier] failed; dead-lettering", err);
          ch.nack(msg, false, false);
        }
      });
      console.log("[notifier] consuming", QUEUE);
      await new Promise((_, reject) => conn.on("close", () => reject(new Error("connection closed"))));
    } catch (e) {
      console.log("[notifier] reconnecting in 3 s:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

void main();

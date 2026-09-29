/**
 * RabbitMQ topology and a connection that heals itself.
 *
 *   routelanka.events   topic   domain events, routing key = event type (e.g. load.flagged)
 *   routelanka.commands direct  work for services (plan.propose → planning engine)
 *   routelanka.dlx      topic   dead letters from any queue
 *
 * Publishing uses a confirm channel: a message counts as sent only when the broker confirms it,
 * which is what lets the outbox relay mark an event as published safely.
 */
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from "amqplib";
import { config } from "./config";

export const EVENTS = "routelanka.events";
export const COMMANDS = "routelanka.commands";
export const DLX = "routelanka.dlx";

type Consumer = { queue: string; bind: { exchange: string; key: string }[]; exclusive?: boolean; onMessage: (msg: ConsumeMessage) => Promise<void> };

let conn: ChannelModel | null = null;
let ch: ConfirmChannel | null = null;
let connecting: Promise<void> | null = null;
const consumers: Consumer[] = [];
const log = (...a: unknown[]) => console.log("[mq]", ...a);

async function setup(channel: ConfirmChannel) {
  await channel.assertExchange(EVENTS, "topic", { durable: true });
  await channel.assertExchange(COMMANDS, "direct", { durable: true });
  await channel.assertExchange(DLX, "topic", { durable: true });
  for (const c of consumers) await attach(channel, c);
}

async function attach(channel: ConfirmChannel, c: Consumer) {
  await channel.assertQueue(c.queue, c.exclusive ? { exclusive: true, autoDelete: true } : { durable: true, arguments: { "x-dead-letter-exchange": DLX, "x-dead-letter-routing-key": `${c.queue}.dead` } });
  if (!c.exclusive) {
    await channel.assertQueue(`${c.queue}.dead`, { durable: true });
    await channel.bindQueue(`${c.queue}.dead`, DLX, `${c.queue}.dead`);
  }
  for (const b of c.bind) await channel.bindQueue(c.queue, b.exchange, b.key);
  await channel.consume(c.queue, async (msg) => {
    if (!msg) return;
    try {
      await c.onMessage(msg);
      channel.ack(msg);
    } catch (e) {
      console.error(`[mq] ${c.queue} failed`, e);
      channel.nack(msg, false, false); // → dead-letter queue
    }
  });
}

async function connect(): Promise<void> {
  for (;;) {
    try {
      conn = await amqp.connect(config.rabbitUrl);
      conn.on("error", (e) => log("connection error", e.message));
      conn.on("close", () => {
        log("connection closed; reconnecting");
        conn = null;
        ch = null;
        setTimeout(() => void ensure(), 1000);
      });
      const channel = await conn.createConfirmChannel();
      await channel.prefetch(20);
      await setup(channel);
      ch = channel;
      log("connected");
      return;
    } catch (e) {
      log("not reachable, retrying in 2 s:", (e as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export function ensure(): Promise<void> {
  if (ch) return Promise.resolve();
  connecting ??= connect().finally(() => (connecting = null));
  return connecting;
}

export const isConnected = () => !!ch;

/** Publish and wait for the broker's confirm. Throws if the broker refuses or the connection drops. */
export async function publish(exchange: string, key: string, body: unknown, headers: Record<string, unknown> = {}, messageId?: string) {
  await ensure();
  const channel = ch!;
  await new Promise<void>((resolve, reject) => {
    channel.publish(exchange, key, Buffer.from(JSON.stringify(body)), { persistent: true, contentType: "application/json", messageId, headers }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Register a consumer. It is (re)attached whenever the connection is (re)established. */
export async function consume(c: Consumer) {
  consumers.push(c);
  if (ch) await attach(ch, c);
  else await ensure();
}

export async function close() {
  await conn?.close().catch(() => {});
}

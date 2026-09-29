import { buildApp } from "./app";
import { config } from "./config";
import { sql } from "./db";
import { close, ensure } from "./mq";
import { startRealtime } from "./realtime";
import { startRelay } from "./relay";

const app = buildApp();

async function main() {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  // Workers start after the port is open, so health checks answer while RabbitMQ is still connecting.
  void startWorkers();
}

/** Outbox relay and realtime consumer. Retried until the database and broker are reachable. */
async function startWorkers() {
  for (;;) {
    try {
      await ensure();
      await startRealtime();
      await startRelay();
      app.log.info("outbox relay and realtime consumer running");
      return;
    } catch (e) {
      app.log.warn(`workers not started yet (${(e as Error).message}); retrying in 3 s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function shutdown() {
  await app.close();
  await close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

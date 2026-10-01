/** HTTP routes. Kept separate from index.ts so tests can build the app without starting workers. */
import cookie from "@fastify/cookie";
import Fastify, { type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { COMMAND_ROLES, type Command, type Role } from "@routelanka/domain";
import { accounts, actor, HttpError, login, logout } from "./auth";
import { runCommand } from "./commands";
import { config } from "./config";
import { sql } from "./db";
import { createDay, loadDay } from "./day";
import { isConnected } from "./mq";
import { watch } from "./realtime";
import { commandSchema, loginSchema, smsSchema, syncSchema } from "./schemas";
import { inboundSms, syncRecords } from "./sync";
import { httpCache } from "./http-cache";
import { buildReference, buildView } from "./view";

const DAY_COOKIE = "rl_day";

async function currentDay(req: FastifyRequest) {
  const day = await loadDay(sql, req.cookies[DAY_COOKIE]);
  if (!day) throw new HttpError(503, "No demo day yet: the seed job hasn't run.");
  return day;
}

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });
  app.register(cookie);
  httpCache(app);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid request", details: err.issues.slice(0, 5) });
    app.log.error(err);
    return reply.code(500).send({ error: "Something went wrong on the server." });
  });

  app.get("/api/health", async () => {
    await sql`SELECT 1`;
    return { ok: true, db: true, broker: isConnected() };
  });

  // ── Sign-in ──
  app.post("/api/auth/login", async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const a = await login(req, reply, username, password);
    return { role: a.role, name: a.name, username: a.username };
  });
  app.post("/api/auth/logout", async (_req, reply) => {
    logout(reply);
    return { ok: true };
  });
  app.get("/api/auth/me", async (req) => ({ accounts: (await accounts(req)).map(({ role, name, username }) => ({ role, name, username })) }));

  // ── Demo days ──
  app.get("/api/day", async (req) => {
    const d = await currentDay(req);
    return { id: d.id, name: d.name, service_date: d.service_date };
  });
  app.post("/api/day/new", async (_req, reply) => {
    const id = await createDay(sql, `Fresh demo day ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
    reply.setCookie(DAY_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/", maxAge: 7 * 24 * 3600 });
    return { id };
  });

  // ── Read side ──
  app.get("/api/reference", async (req) => buildReference(await currentDay(req)));
  app.get("/api/view", async (req) => {
    const day = await currentDay(req);
    // Secrets (handover codes) only for a role that is actually signed in.
    let role: Role | undefined;
    try {
      role = (await actor(req)).role;
    } catch {
      role = undefined;
    }
    return buildView(day, role);
  });
  app.get<{ Querystring: { outlet?: string } }>("/api/messages", async (req) => {
    const day = await currentDay(req);
    await actor(req, ["store"]);
    const outlet = String(req.query.outlet ?? "");
    return sql`SELECT id, channel, direction, template, vars, replies, day, at, order_ref FROM messages
               WHERE workspace_id = ${day.id} AND outlet_id = ${outlet} ORDER BY (day = 'Today'), at, created_at`;
  });

  // ── Write side ──
  app.post("/api/commands", async (req) => {
    const cmd = commandSchema.parse(req.body) as Command;
    const who = await actor(req, COMMAND_ROLES[cmd.type]);
    const day = await currentDay(req);
    return runCommand(day.id, cmd, who);
  });
  app.post("/api/sync", async (req) => {
    const body = syncSchema.parse(req.body);
    const who = await actor(req, ["driver"]);
    const day = await currentDay(req);
    return syncRecords(day.id, body.events, body.offline, who);
  });
  // The SMS gateway posts messages from drivers' phones here.
  app.post("/api/sms/inbound", async (req) => {
    const { token, body } = smsSchema.parse(req.body);
    if (token !== config.smsGatewayToken) throw new HttpError(401, "Bad gateway token.");
    const day = await currentDay(req);
    return inboundSms(day.id, body);
  });

  // Demo stand-in for the mobile network: the driver's phone "sends" the SMS, the network delivers it to
  // the gateway. On a real phone the app opens the SMS composer instead (sms: link to the gateway number).
  app.post("/api/sms/simulate", async (req) => {
    if (!config.smsSimulator) throw new HttpError(404, "Not found.");
    await actor(req, ["driver"]);
    const { body } = smsSchema.pick({ body: true }).parse(req.body);
    const day = await currentDay(req);
    return inboundSms(day.id, body);
  });

  // ── Realtime ──
  app.get("/api/stream", async (req, reply) => {
    const day = await currentDay(req);
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ day: day.id })}\n\n`);
    const stop = watch(day.id, reply);
    req.raw.on("close", stop);
    return reply;
  });

  return app;
}

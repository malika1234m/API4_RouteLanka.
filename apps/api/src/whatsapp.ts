/**
 * WhatsApp Business Platform webhook: delivery statuses and the stores' replies come back here from Meta (or from
 * the bundled Cloud API simulator, which signs its webhooks the same way).
 *
 *   GET  /api/whatsapp/webhook   Meta's one-time URL verification (hub.challenge)
 *   POST /api/whatsapp/webhook   signed events: X-Hub-Signature-256 = sha256 HMAC of the raw body with the app secret
 *   GET  /api/whatsapp/console   the integration log for the dispatcher (and judges)
 *
 * A tap on a reply button carries the command the app would send (see encodeReply in the domain package), so a
 * WhatsApp reply goes through the same handler, rules and events as a tap in the app.
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { decodeReply, formatPhone, isStop, joinText, parseJoin, renderMessage, STATUS_RANK, tappedId, templateCatalogue, WA_API_VERSION, waMeLink, type WaWebhook } from "@routelanka/domain";
import { z } from "zod";
import { actor, coversStore, HttpError, type Account } from "./auth";
import { runCommand } from "./commands";
import { config } from "./config";
import { sql } from "./db";
import { currentDay } from "./day";

/** Commands a store may send by WhatsApp. */
const STORE_COMMANDS = new Set(["ack", "storeReply", "receive"]);

export function signatureOk(raw: string, header: string | undefined, secret = config.whatsappAppSecret): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A message we send in reply (the report link, or "use the buttons"), through the same outbox as the rest. */
async function reply(workspace: string, outlet: string, orderRef: string | null, template: string, vars: Record<string, string> = {}) {
  await sql`INSERT INTO messages (workspace_id, source_event, channel, outlet_id, order_ref, direction, template, vars, day, at, wa_status)
            SELECT ${workspace}, ${randomUUID()}, 'whatsapp', ${outlet}, ${orderRef}, 'in', ${template}, ${sql.json(vars)}, 'Today',
                   to_char(now() AT TIME ZONE 'Asia/Colombo', 'HH24:MI'), ${config.whatsappMode === "off" ? "local" : "pending"}`;
}

/** A note in the store's messages that is shown in the app only (nothing is sent). */
async function notice(workspace: string, outlet: string, template: string, vars: Record<string, string> = {}) {
  await sql`INSERT INTO messages (workspace_id, source_event, channel, outlet_id, direction, template, vars, day, at, wa_status)
            VALUES (${workspace}, ${randomUUID()}, 'whatsapp', ${outlet}, 'in', ${template}, ${sql.json(vars)}, 'Today',
                    to_char(now() AT TIME ZONE 'Asia/Colombo', 'HH24:MI'), 'local')`;
}

/** The demo day a store's WhatsApp traffic belongs to: its latest message's, else the default day. */
async function storeDay(outlet: string): Promise<string | undefined> {
  const [r] = await sql<{ id: string }[]>`
    (SELECT workspace_id AS id FROM messages WHERE outlet_id = ${outlet} ORDER BY created_at DESC LIMIT 1)
    UNION ALL (SELECT id FROM workspaces WHERE is_default) LIMIT 1`;
  return r?.id;
}

const JOIN_MINUTES = 30;
const JOIN_MAX_WRONG = 5;

/**
 * "JOIN OUT034 482193" from a phone: link that phone to the store if the code is the store's open one. The
 * store sent it from its own phone, so the number is verified and this is its opt-in.
 */
async function connectByJoin(phone: string, join: { outlet: string; code: string }): Promise<string> {
  return sql.begin(async (tx) => {
    const [c] = await tx<{ code: string; created_by: string | null; workspace_id: string | null; expired: boolean; attempts: number }[]>`
      SELECT code, created_by, workspace_id, expires_at < now() AS expired, attempts FROM wa_join_codes WHERE outlet_id = ${join.outlet} FOR UPDATE`;
    if (!c || c.expired) return `JOIN for ${join.outlet} from ${phone}: no open code (expired or never asked for); ignored`;
    if (c.code !== join.code) {
      // A few wrong guesses and the code is void: the store asks for a new one.
      if (c.attempts + 1 >= JOIN_MAX_WRONG) await tx`DELETE FROM wa_join_codes WHERE outlet_id = ${join.outlet}`;
      else await tx`UPDATE wa_join_codes SET attempts = attempts + 1 WHERE outlet_id = ${join.outlet}`;
      return `JOIN for ${join.outlet} from ${phone}: wrong code; refused`;
    }
    const [other] = await tx<{ outlet_id: string }[]>`SELECT outlet_id FROM outlet_contacts WHERE phone = ${phone} AND outlet_id <> ${join.outlet}`;
    if (other) return `JOIN for ${join.outlet} from ${phone}: that number is already connected to ${other.outlet_id}; refused`;
    await tx`DELETE FROM wa_join_codes WHERE outlet_id = ${join.outlet}`;
    await tx`INSERT INTO outlet_contacts (outlet_id, phone, live, opted_in_at, last_inbound_at, source, connected_by)
             VALUES (${join.outlet}, ${phone}, true, now(), now(), 'join', ${c.created_by})
             ON CONFLICT (outlet_id) DO UPDATE SET phone = EXCLUDED.phone, live = true, opted_in_at = now(), last_inbound_at = now(),
                                                   source = 'join', connected_by = EXCLUDED.connected_by`;
    const day = c.workspace_id ?? (await storeDay(join.outlet));
    // Inside the 24-hour window (the store just wrote), so the confirmation goes as free-form text.
    if (day)
      await tx`INSERT INTO messages (workspace_id, source_event, channel, outlet_id, direction, template, vars, day, at, wa_status)
               VALUES (${day}, ${randomUUID()}, 'whatsapp', ${join.outlet}, 'in',
                       ${"✅ WhatsApp connected. Delivery updates for {o} now come to this number. Send STOP to turn them off."},
                       ${tx.json({ o: join.outlet })}, 'Today', to_char(now() AT TIME ZONE 'Asia/Colombo', 'HH24:MI'),
                       ${config.whatsappMode === "off" ? "local" : "pending"})`;
    return `${join.outlet} connected WhatsApp ${phone} (JOIN with a valid code)`;
  });
}

/** The store account a WhatsApp reply acts as: the outlet's own, or the store role's (the demo has one per role). */
async function storeAccount(outlet: string): Promise<Account> {
  const [u] = await sql<{ id: string; username: string; display_name: string }[]>`
    SELECT id, username, display_name FROM users WHERE role = 'store' AND active
    ORDER BY (outlet_id = ${outlet}) DESC, (district = (SELECT district FROM outlets WHERE outlet_id = ${outlet})) DESC, created_at LIMIT 1`;
  // The message came from that outlet's own WhatsApp number, so it acts for that outlet.
  const [o] = await sql<{ district: string }[]>`SELECT district FROM outlets WHERE outlet_id = ${outlet}`;
  return { uid: u.id, role: "store", name: u.display_name, username: u.username, outlet_id: outlet, district: o?.district };
}

async function handle(body: WaWebhook): Promise<string[]> {
  const notes: string[] = [];
  for (const change of body.entry?.flatMap((e) => e.changes ?? []) ?? []) {
    const v = change.value;
    for (const st of v.statuses ?? []) {
      // Statuses only move forward; a failure is always recorded.
      const rows = await sql`UPDATE messages SET wa_status = ${st.status}, wa_status_at = now(),
                               wa_error = ${st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title}` : null}
                             WHERE wa_id = ${st.id}
                               AND (${st.status} = 'failed' OR ${STATUS_RANK[st.status] ?? -1} > (CASE wa_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END))
                             RETURNING id`;
      notes.push(`status ${st.status} for ${st.id}${rows.length ? "" : " (ignored: unknown or older)"}`);
    }
    for (const m of v.messages ?? []) {
      const [fresh] = await sql`INSERT INTO wa_inbound (wamid) VALUES (${m.id}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (!fresh) {
        notes.push(`duplicate ${m.id}: already applied`);
        continue;
      }
      const text = m.type === "text" ? (m.text?.body ?? "") : "";
      const join = parseJoin(text);
      if (join) {
        notes.push(await connectByJoin(m.from, join));
        continue;
      }
      const [contact] = await sql<{ outlet_id: string }[]>`
        UPDATE outlet_contacts SET last_inbound_at = now() WHERE phone = ${m.from} RETURNING outlet_id`;
      if (!contact) {
        notes.push(`message from unknown number ${m.from}: ignored`);
        continue;
      }
      const outlet = contact.outlet_id;
      if (isStop(text)) {
        // The store turned WhatsApp off from its phone. Updates keep coming in the app.
        await sql`DELETE FROM outlet_contacts WHERE outlet_id = ${outlet} AND phone = ${m.from}`;
        const day = await storeDay(outlet);
        if (day) await notice(day, outlet, "WhatsApp turned off from {p} (STOP). Updates still show here in the app.", { p: formatPhone(m.from) });
        notes.push(`${outlet} sent STOP: WhatsApp disconnected`);
        continue;
      }
      const id = tappedId(m);
      const action = id ? decodeReply(id) : null;
      if (!action) {
        // Free text: we don't run a chat channel (the design keeps replies structured); point to the buttons.
        const [last] = await sql<{ workspace_id: string }[]>`SELECT workspace_id FROM messages WHERE outlet_id = ${outlet} ORDER BY created_at DESC LIMIT 1`;
        if (last) await reply(last.workspace_id, outlet, null, "Please use the buttons under each message.");
        notes.push(`${outlet} sent ${m.type}: answered with "use the buttons"`);
        continue;
      }
      if ("report" in action) {
        await reply(action.workspace, outlet, action.report, "Open this link to report the problem: {u}", { u: `${config.publicUrl}/store/receive/${action.report}` });
        notes.push(`${outlet} wants to report a problem with ${action.report}: link sent`);
        continue;
      }
      const cmd = action.command as { type: string; ref?: string };
      if (!STORE_COMMANDS.has(cmd.type)) {
        notes.push(`${outlet}: ${cmd.type} is not a store reply; refused`);
        continue;
      }
      // A store can only act on its own orders, in the demo day the message came from.
      const [own] = await sql`SELECT 1 FROM orders WHERE workspace_id = ${action.workspace} AND order_ref = ${cmd.ref ?? ""} AND outlet_id = ${outlet}`;
      if (!own) {
        notes.push(`${outlet} tried ${cmd.type} on ${cmd.ref}, which is not its order; refused`);
        continue;
      }
      try {
        await runCommand(action.workspace, cmd as never, await storeAccount(outlet));
        notes.push(`${outlet} tapped ${cmd.type} for ${cmd.ref}: applied`);
      } catch (e) {
        notes.push(`${outlet} tapped ${cmd.type} for ${cmd.ref}: refused (${(e as Error).message})`);
      }
    }
  }
  return notes;
}

export function whatsappRoutes(app: FastifyInstance) {
  app.register(async (scope) => {
    // The signature covers the exact bytes Meta sent, so keep the raw body.
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (e) {
        done(e as Error, undefined);
      }
    });

    scope.get<{ Querystring: Record<string, string> }>("/api/whatsapp/webhook", async (req, reply) => {
      const q = req.query;
      if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === config.whatsappVerifyToken) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      return reply.code(403).send({ error: "Verification token doesn't match." });
    });

    scope.post("/api/whatsapp/webhook", async (req, reply) => {
      const raw = (req as unknown as { rawBody: string }).rawBody ?? "";
      const ok = signatureOk(raw, req.headers["x-hub-signature-256"] as string | undefined);
      const body = req.body as WaWebhook;
      const kind = body?.entry?.[0]?.changes?.[0]?.value?.statuses ? "statuses" : body?.entry?.[0]?.changes?.[0]?.value?.messages ? "messages" : "other";
      const phone = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ?? body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.recipient_id ?? null;
      if (!ok) {
        await sql`INSERT INTO wa_log (direction, kind, http_status, signature_ok, phone, request, note)
                  VALUES ('webhook', ${kind}, 401, false, ${phone}, ${sql.json(body as never)}, 'rejected: signature does not match the app secret')`;
        return reply.code(401).send({ error: "Invalid signature." });
      }
      const notes = await handle(body);
      const [msg] = phone ? await sql<{ workspace_id: string }[]>`SELECT m.workspace_id FROM messages m JOIN outlet_contacts c USING (outlet_id) WHERE c.phone = ${phone} ORDER BY m.created_at DESC LIMIT 1` : [];
      await sql`INSERT INTO wa_log (workspace_id, direction, kind, http_status, signature_ok, phone, request, note)
                VALUES (${msg?.workspace_id ?? null}, 'webhook', ${kind}, 200, true, ${phone}, ${sql.json(body as never)}, ${notes.join("; ")})`;
      return { ok: true };
    });
  });

  // ── A store connects its own WhatsApp number ──
  const outletBody = z.object({ outlet: z.string().regex(/^OUT\d{3}$/) });
  const storeFor = async (req: Parameters<typeof actor>[0], outlet: string) => {
    const who = await actor(req, ["store"]);
    const [o] = await sql<{ district: string }[]>`SELECT district FROM outlets WHERE outlet_id = ${outlet}`;
    if (!o) throw new HttpError(404, "Unknown store.");
    if (!coversStore(who, { outlet_id: outlet, district: o.district })) throw new HttpError(403, "That's another store's WhatsApp.");
    return who;
  };
  const connection = async (outlet: string) => {
    const [[c], [j]] = await Promise.all([
      sql<{ phone: string; source: string; opted_in_at: Date; by: string | null }[]>`
        SELECT c.phone, c.source, c.opted_in_at, u.display_name AS by FROM outlet_contacts c LEFT JOIN users u ON u.id = c.connected_by WHERE c.outlet_id = ${outlet}`,
      sql<{ code: string; expires_at: Date }[]>`SELECT code, expires_at FROM wa_join_codes WHERE outlet_id = ${outlet} AND expires_at > now()`,
    ]);
    const text = j ? joinText(outlet, j.code) : null;
    return {
      outlet,
      mode: config.whatsappMode,
      business: formatPhone(config.whatsappBusinessNumber),
      connected: c ? { phone: formatPhone(c.phone), number: c.phone, source: c.source, since: c.opted_in_at, by: c.by } : null,
      pending: j && text ? { text, expires_at: j.expires_at, link: waMeLink(config.whatsappBusinessNumber, text), simulator: `/wa-sim/?text=${encodeURIComponent(text)}` } : null,
    };
  };
  app.get<{ Querystring: { outlet?: string } }>("/api/whatsapp/connection", async (req) => {
    const { outlet } = outletBody.parse(req.query);
    await storeFor(req, outlet);
    return connection(outlet);
  });
  app.post("/api/whatsapp/connect", async (req) => {
    const { outlet } = outletBody.parse(req.body);
    const who = await storeFor(req, outlet);
    const day = await currentDay(req);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sql`INSERT INTO wa_join_codes (outlet_id, code, created_by, workspace_id, expires_at)
              VALUES (${outlet}, ${code}, ${who.uid}, ${day.id}, now() + make_interval(mins => ${JOIN_MINUTES}))
              ON CONFLICT (outlet_id) DO UPDATE SET code = EXCLUDED.code, created_by = EXCLUDED.created_by, workspace_id = EXCLUDED.workspace_id,
                                                    expires_at = EXCLUDED.expires_at, attempts = 0`;
    return connection(outlet);
  });
  app.post("/api/whatsapp/disconnect", async (req) => {
    const { outlet } = outletBody.parse(req.body);
    const who = await storeFor(req, outlet);
    const day = await currentDay(req);
    const [gone] = await sql<{ phone: string }[]>`DELETE FROM outlet_contacts WHERE outlet_id = ${outlet} RETURNING phone`;
    await sql`DELETE FROM wa_join_codes WHERE outlet_id = ${outlet}`;
    if (gone) await notice(day.id, outlet, "WhatsApp disconnected by {n}. Updates still show here in the app.", { n: who.name });
    return connection(outlet);
  });

  // ── The integration console ──
  app.get("/api/whatsapp/console", async (req) => {
    await actor(req, ["dispatcher"]);
    const day = await currentDay(req);
    const [stats, log, contacts] = await Promise.all([
      sql<{ wa_status: string; n: number }[]>`SELECT wa_status, count(*)::int AS n FROM messages WHERE workspace_id = ${day.id} AND direction = 'in' GROUP BY wa_status`,
      sql`(SELECT l.id, l.at, l.direction, l.kind, l.http_status, l.signature_ok, l.phone, l.request, l.response, l.note,
                  coalesce(m.outlet_id, c.outlet_id) AS outlet_id, m.order_ref, m.template, m.vars, m.wa_status, m.wa_error
           FROM wa_log l LEFT JOIN messages m ON m.id = l.message_id LEFT JOIN outlet_contacts c ON c.phone = l.phone
           WHERE (l.workspace_id = ${day.id} OR (l.workspace_id IS NULL AND l.at > now() - interval '1 day'))
             -- Status webhooks are listed separately below; a rejected one (bad signature) always shows here.
             AND (l.kind <> 'statuses' OR l.signature_ok = false)
           ORDER BY l.id DESC LIMIT 400)
          UNION ALL
          (SELECT l.id, l.at, l.direction, l.kind, l.http_status, l.signature_ok, l.phone, l.request, l.response, l.note,
                  c.outlet_id, NULL, NULL, NULL, NULL, NULL
           FROM wa_log l LEFT JOIN outlet_contacts c ON c.phone = l.phone
           WHERE l.workspace_id = ${day.id} AND l.kind = 'statuses'
           ORDER BY l.id DESC LIMIT 100)
          ORDER BY id DESC`,
      sql`SELECT outlet_id, phone, live, source, last_inbound_at FROM outlet_contacts ORDER BY outlet_id`,
    ]);
    const timing = await sql<{ to_delivered: number | null; to_read: number | null }[]>`
      SELECT avg(extract(epoch FROM wa_status_at - wa_sent_at)) FILTER (WHERE wa_status IN ('delivered', 'read')) AS to_delivered,
             avg(extract(epoch FROM wa_status_at - wa_sent_at)) FILTER (WHERE wa_status = 'read') AS to_read
      FROM messages WHERE workspace_id = ${day.id} AND wa_sent_at IS NOT NULL`;
    return {
      config: {
        mode: config.whatsappMode,
        endpoint: `${new URL(config.whatsappApiBase).host}/${WA_API_VERSION}/${config.whatsappPhoneNumberId.replace(/\d(?=\d{4})/g, "•")}/messages`,
        webhook: `${config.publicUrl}/api/whatsapp/webhook`,
        signing: config.whatsappAppSecret === "dev-wa-app-secret" ? "development app secret (simulator)" : "app secret set",
      },
      stats: Object.fromEntries(stats.map((s) => [s.wa_status, s.n])),
      timing: timing[0],
      contacts,
      templates: templateCatalogue(),
      log: log.map((l) => ({ ...l, text: l.template ? renderMessage("en", l.template as string, (l.vars ?? {}) as never).replace(/\*\*/g, "") : null })),
    };
  });
}

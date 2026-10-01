/**
 * WhatsApp sender: delivers the store messages the notifier writes, through the WhatsApp Business Platform
 * (Cloud API). The messages table is the outbox: rows marked `pending` are sent here, at least once, and the
 * webhook (apps/api/src/whatsapp.ts) moves them on to delivered and read.
 *
 * WHATSAPP_MODE   off | simulator | cloud (default off)
 * WHATSAPP_API_BASE        https://graph.facebook.com (cloud) or http://wa-sim:3200 (simulator)
 * WHATSAPP_PHONE_NUMBER_ID the business phone number's id in Meta's WhatsApp Manager
 * WHATSAPP_TOKEN           a system-user access token (never logged)
 * WHATSAPP_LIVE_NUMBERS    "OUT029:9477xxxxxxx,…": real numbers that may be messaged in cloud mode
 */
import { buildPayload, WA_API_VERSION, WINDOW_HOURS, type Lang, type StoreMessage } from "@routelanka/domain";
import type postgres from "postgres";

type Sql = postgres.Sql;
export type Mode = "off" | "simulator" | "cloud";

export const config = {
  mode: (process.env.WHATSAPP_MODE ?? "off") as Mode,
  base: process.env.WHATSAPP_API_BASE ?? (process.env.WHATSAPP_MODE === "cloud" ? "https://graph.facebook.com" : "http://wa-sim:3200"),
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "100000000000001",
  token: process.env.WHATSAPP_TOKEN ?? "",
  liveNumbers: process.env.WHATSAPP_LIVE_NUMBERS ?? "",
};

const MAX_ATTEMPTS = 5;

interface Row extends StoreMessage {
  id: string;
  workspace_id: string;
  outlet_id: string;
  wa_attempts: number;
  phone: string | null;
  live: boolean | null;
  window_open: boolean;
  lang: Lang | null;
}

/** Real numbers for a deployment: OUT029:94771234567 makes OUT029 reachable on that phone. */
async function applyLiveNumbers(sql: Sql) {
  for (const pair of config.liveNumbers.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [outlet, phone] = pair.split(":");
    if (!/^OUT\d{3}$/.test(outlet ?? "") || !/^\d{8,15}$/.test(phone ?? "")) {
      console.warn(`[whatsapp] ignoring WHATSAPP_LIVE_NUMBERS entry "${pair}" (expected OUT029:94771234567)`);
      continue;
    }
    await sql`UPDATE outlet_contacts SET phone = ${phone}, live = true WHERE outlet_id = ${outlet}`;
    console.log(`[whatsapp] ${outlet} -> live number ending ${phone.slice(-4)}`);
  }
}

/** One Cloud API call. Returns the HTTP status and parsed body; network failures come back as status 0. */
async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = `${config.base}/${WA_API_VERSION}/${config.phoneNumberId}/messages`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch (e) {
    return { status: 0, json: { error: { message: (e as Error).message } } };
  }
}

async function sendBatch(sql: Sql): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx<Row[]>`
      SELECT m.id, m.workspace_id, m.outlet_id, m.order_ref, m.template, m.vars, m.replies, m.wa_attempts, c.phone, c.live,
             coalesce(c.last_inbound_at > now() - make_interval(hours => ${WINDOW_HOURS}), false) AS window_open,
             (SELECT u.lang FROM users u WHERE u.role = 'store' AND u.outlet_id = m.outlet_id ORDER BY u.created_at LIMIT 1) AS lang
      FROM messages m LEFT JOIN outlet_contacts c ON c.outlet_id = m.outlet_id
      WHERE m.wa_status = 'pending' AND (m.wa_next_attempt IS NULL OR m.wa_next_attempt <= now())
      ORDER BY m.created_at LIMIT 20
      FOR UPDATE OF m SKIP LOCKED`;
    for (const m of rows) {
      if (!m.phone || (config.mode === "cloud" && !m.live)) {
        const why = !m.phone ? "no WhatsApp number for this outlet" : "not a live number (set WHATSAPP_LIVE_NUMBERS)";
        await tx`UPDATE messages SET wa_status = 'skipped', wa_error = ${why}, wa_status_at = now() WHERE id = ${m.id}`;
        continue;
      }
      const payload = buildPayload(m, m.phone, m.lang ?? "en", m.workspace_id, m.window_open);
      const res = await post(payload);
      const waId = ((res.json.messages as { id: string }[] | undefined) ?? [])[0]?.id ?? null;
      await tx`INSERT INTO wa_log (workspace_id, message_id, direction, kind, http_status, phone, request, response, note)
               VALUES (${m.workspace_id}, ${m.id}, 'outbound', ${payload.type}, ${res.status}, ${m.phone}, ${tx.json(payload as never)}, ${tx.json(res.json as never)},
                       ${m.window_open ? "inside the 24-hour window: free-form" : "outside the 24-hour window: approved template"})`;
      if (res.status >= 200 && res.status < 300 && waId) {
        await tx`UPDATE messages SET wa_status = 'sent', wa_id = ${waId}, wa_kind = ${payload.type}, wa_sent_at = now(), wa_status_at = now(),
                   wa_attempts = wa_attempts + 1, wa_error = NULL WHERE id = ${m.id}`;
        continue;
      }
      const err = (res.json.error as { message?: string; code?: number } | undefined) ?? {};
      const retry = res.status === 0 || res.status === 429 || res.status >= 500;
      const attempts = m.wa_attempts + 1;
      const giveUp = !retry || attempts >= MAX_ATTEMPTS;
      await tx`UPDATE messages SET wa_attempts = ${attempts}, wa_error = ${`${err.code ?? res.status}: ${err.message ?? "no answer"}`},
                 wa_status = ${giveUp ? "failed" : "pending"}, wa_status_at = now(),
                 wa_next_attempt = ${giveUp ? null : new Date(Date.now() + 5_000 * 2 ** attempts)} WHERE id = ${m.id}`;
    }
    return rows.length;
  });
}

/** Send pending messages every half second (sooner when a batch was full). Runs for the life of the process. */
export async function startSender(sql: Sql) {
  if (config.mode === "off") {
    console.log("[whatsapp] off: messages are shown in the app only (set WHATSAPP_MODE)");
    return;
  }
  await applyLiveNumbers(sql);
  console.log(`[whatsapp] ${config.mode} mode: sending through ${config.base}/${WA_API_VERSION}/${config.phoneNumberId}/messages`);
  for (;;) {
    let n = 0;
    try {
      n = await sendBatch(sql);
    } catch (e) {
      console.error("[whatsapp] send loop:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, n >= 20 ? 50 : 500));
  }
}

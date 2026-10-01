/**
 * The Cloud API side of the simulator: accepts `POST /v21.0/{phone-number-id}/messages` exactly as Meta's Graph API
 * does (same body, same answers, same errors), delivers each message to a simulated phone, and reports statuses and
 * replies to the business's webhook, signed with the app secret as Meta signs them.
 */
import { createHmac, randomBytes } from "node:crypto";
import { TEMPLATE_BODY, TEMPLATE_LANGS, tr, WA_TEMPLATES, WINDOW_HOURS, type Lang, type TemplateName } from "@routelanka/domain";

export const cfg = {
  token: process.env.WA_SIM_TOKEN ?? "dev-wa-token",
  appSecret: process.env.WA_SIM_APP_SECRET ?? "dev-wa-app-secret",
  webhookUrl: process.env.WA_SIM_WEBHOOK_URL ?? "http://api:4000/api/whatsapp/webhook",
  phoneNumberId: process.env.WA_SIM_PHONE_NUMBER_ID ?? "100000000000001",
  wabaId: "200000000000002",
};

export interface Button {
  title: string;
  /** What comes back when tapped: a quick-reply payload (template) or a reply id (interactive). */
  value: string;
  kind: "quick_reply" | "reply";
}
export interface PhoneMessage {
  id: string;
  at: number;
  from: "business" | "customer";
  kind: "template" | "interactive" | "text" | "button";
  text: string;
  template?: string;
  lang?: string;
  buttons: Button[];
  status: "accepted" | "sent" | "delivered" | "read" | "failed";
  error?: string;
  tapped?: string;
}
export interface Phone {
  number: string;
  messages: PhoneMessage[];
  lastCustomerAt?: number;
}
export interface WireEntry {
  at: number;
  direction: "api" | "webhook";
  summary: string;
  ok: boolean;
  http: number;
  request: unknown;
  response: unknown;
  headers?: Record<string, string>;
  phone?: string;
  status?: boolean;
}

export const phones = new Map<string, Phone>();
export const wire: WireEntry[] = [];
const log = (e: WireEntry) => {
  wire.unshift(e);
  wire.length = Math.min(wire.length, 400);
};
const phone = (n: string) => phones.get(n) ?? (phones.set(n, { number: n, messages: [] }), phones.get(n)!);
const wamid = () => `wamid.SIM${randomBytes(12).toString("base64url")}`;
const LANG_OF: Record<string, Lang> = Object.fromEntries(Object.entries(TEMPLATE_LANGS).map(([k, v]) => [v, k as Lang]));

/** Meta's error envelope. */
const metaError = (code: number, message: string, details: string) => ({
  error: { message, type: "OAuthException", code, error_data: { messaging_product: "whatsapp", details }, fbtrace_id: randomBytes(8).toString("hex") },
});

type Body = Record<string, unknown> & { to?: string; type?: string };

/** Validate a send request the way the Cloud API does. Returns the message to deliver, or a reason it's invalid. */
export function validate(b: Body): { msg: Omit<PhoneMessage, "id" | "at" | "status"> } | { error: string } {
  if (b.messaging_product !== "whatsapp") return { error: "messaging_product must be \"whatsapp\"" };
  if (typeof b.to !== "string" || !/^\d{8,15}$/.test(b.to)) return { error: "to must be a phone number in international format, digits only" };
  if (b.type === "text") {
    const body = (b.text as { body?: string } | undefined)?.body;
    if (!body || body.length > 4096) return { error: "text.body is required (at most 4096 characters)" };
    return { msg: { from: "business", kind: "text", text: body, buttons: [] } };
  }
  if (b.type === "interactive") {
    const i = b.interactive as { type?: string; body?: { text?: string }; action?: { buttons?: { type: string; reply: { id: string; title: string } }[] } };
    if (i?.type !== "button") return { error: "interactive.type must be \"button\"" };
    if (!i.body?.text || i.body.text.length > 1024) return { error: "interactive.body.text is required (at most 1024 characters)" };
    const bs = i.action?.buttons ?? [];
    if (bs.length < 1 || bs.length > 3) return { error: "interactive buttons: 1 to 3" };
    for (const x of bs) {
      if (x.type !== "reply" || !x.reply?.id || !x.reply.title) return { error: "each button needs type \"reply\", an id and a title" };
      if ([...x.reply.title].length > 20) return { error: `button title "${x.reply.title}" is longer than 20 characters` };
      if (x.reply.id.length > 256) return { error: "button id is longer than 256 characters" };
    }
    if (new Set(bs.map((x) => x.reply.id)).size !== bs.length) return { error: "button ids must be unique" };
    return { msg: { from: "business", kind: "interactive", text: i.body.text, buttons: bs.map((x) => ({ title: x.reply.title, value: x.reply.id, kind: "reply" })) } };
  }
  if (b.type === "template") {
    const t = b.template as { name?: string; language?: { code?: string }; components?: { type: string; sub_type?: string; index?: string; parameters?: { type: string; text?: string; payload?: string }[] }[] };
    const def = WA_TEMPLATES[t?.name as TemplateName];
    if (!def) return { error: `template name "${t?.name}" does not exist (not approved)` };
    const lang = LANG_OF[t.language?.code ?? ""];
    if (!lang) return { error: `template "${t.name}" does not exist in language "${t.language?.code}"` };
    const body = t.components?.find((c) => c.type === "body");
    const p = body?.parameters ?? [];
    if (p.length !== 1 || p[0].type !== "text" || !p[0].text) return { error: "the body takes exactly 1 text parameter ({{1}})" };
    if (/[\n\t]| {5,}/.test(p[0].text)) return { error: "parameter text can't have new lines, tabs or more than 4 consecutive spaces" };
    const buttons = (t.components ?? []).filter((c) => c.type === "button");
    if (buttons.length !== def.buttons.length) return { error: `template "${t.name}" has ${def.buttons.length} quick-reply buttons; ${buttons.length} given` };
    for (const [n, c] of buttons.entries()) {
      if (c.sub_type !== "quick_reply" || c.index !== String(n) || c.parameters?.[0]?.type !== "payload" || !c.parameters[0].payload)
        return { error: `button ${n}: expected sub_type quick_reply, index "${n}" and a payload` };
    }
    return {
      msg: {
        from: "business",
        kind: "template",
        template: t.name,
        lang: t.language!.code,
        text: tr(lang, TEMPLATE_BODY).replace("{{1}}", p[0].text),
        buttons: def.buttons.map((title, n) => ({ title: tr(lang, title), value: buttons[n].parameters![0].payload!, kind: "quick_reply" })),
      },
    };
  }
  return { error: `type "${b.type}" is not supported here (text, interactive, template)` };
}

/** POST /v21.0/{phone-number-id}/messages */
export function sendMessage(pid: string, auth: string | undefined, b: Body): { status: number; json: unknown } {
  let out: { status: number; json: unknown };
  if (auth !== `Bearer ${cfg.token}`) out = { status: 401, json: metaError(190, "Invalid OAuth access token - Cannot parse access token", "check the access token") };
  else if (pid !== cfg.phoneNumberId) out = { status: 400, json: metaError(100, "(#100) Invalid parameter", `unknown phone number id ${pid}`) };
  else {
    const v = validate(b);
    if ("error" in v) out = { status: 400, json: metaError(100, "(#100) Invalid parameter", v.error) };
    else {
      const id = wamid();
      const p = phone(b.to!);
      const m: PhoneMessage = { ...v.msg, id, at: Date.now(), status: "accepted" };
      p.messages.push(m);
      out = { status: 200, json: { messaging_product: "whatsapp", contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id }] } };
      // Like WhatsApp: a free-form message outside the 24-hour window is accepted, then fails (131047).
      const windowOpen = !!p.lastCustomerAt && Date.now() - p.lastCustomerAt < WINDOW_HOURS * 3600_000;
      if (m.kind !== "template" && !windowOpen) {
        setTimeout(() => setStatus(p, m, "failed", { code: 131047, title: "Re-engagement message" }), 300);
      } else {
        setTimeout(() => setStatus(p, m, "sent"), 250);
        setTimeout(() => setStatus(p, m, "delivered"), 900);
      }
    }
  }
  log({ at: Date.now(), direction: "api", summary: `POST /${pid}/messages ${b.type ?? "?"} to ${b.to ?? "?"}`, ok: out.status === 200, http: out.status, request: b, response: out.json, phone: b.to });
  return out;
}

function setStatus(p: Phone, m: PhoneMessage, status: "sent" | "delivered" | "read" | "failed", error?: { code: number; title: string }) {
  const order = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  if (status !== "failed" && order[status] <= order[m.status]) return;
  m.status = status;
  if (error) m.error = `${error.code}: ${error.title}`;
  void webhook({
    statuses: [{ id: m.id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: p.number, ...(error ? { errors: [{ code: error.code, title: error.title }] } : {}) }],
  }, `status ${status} for ${m.id.slice(0, 18)}…`);
}

/** The phone opened the chat: everything from the business is read. */
export function markRead(number: string) {
  const p = phones.get(number);
  for (const m of p?.messages ?? []) if (m.from === "business" && (m.status === "sent" || m.status === "delivered")) setStatus(p!, m, "read");
}

/** The store taps a button, or types a message. */
export function customerSends(number: string, input: { tap?: { messageId: string; button: number } } | { text: string }) {
  const p = phone(number);
  const id = wamid();
  let value: Record<string, unknown>;
  let shown: string;
  if ("tap" in input && input.tap) {
    const m = p.messages.find((x) => x.id === input.tap!.messageId);
    const b = m?.buttons[input.tap.button];
    if (!m || !b) return { error: "no such button" };
    m.tapped = b.title;
    shown = b.title;
    value =
      b.kind === "quick_reply"
        ? { type: "button", context: { from: cfg.phoneNumberId, id: m.id }, button: { payload: b.value, text: b.title } }
        : { type: "interactive", context: { from: cfg.phoneNumberId, id: m.id }, interactive: { type: "button_reply", button_reply: { id: b.value, title: b.title } } };
  } else if ("text" in input) {
    shown = input.text;
    value = { type: "text", text: { body: input.text } };
  } else return { error: "nothing to send" };
  p.lastCustomerAt = Date.now();
  p.messages.push({ id, at: Date.now(), from: "customer", kind: "button", text: shown, buttons: [], status: "sent" });
  void webhook({ contacts: [{ profile: { name: `Store ${number.slice(-3)}` }, wa_id: number }], messages: [{ from: number, id, timestamp: String(Math.floor(Date.now() / 1000)), ...value }] }, `reply from ${number}: "${shown}"`);
  return { id };
}

// ── Webhooks ──
let lastBody = "";

function envelope(value: Record<string, unknown>) {
  return { object: "whatsapp_business_account", entry: [{ id: cfg.wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "94110000000", phone_number_id: cfg.phoneNumberId }, ...value } }] }] };
}

export const sign = (raw: string, secret = cfg.appSecret) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

/** Deliver to the business's webhook; retry like Meta until it answers 200 (up to 4 tries here). */
async function post(raw: string, signature: string, summary: string, tries = 4, phone?: string, status = false): Promise<number> {
  for (let n = 1; n <= tries; n++) {
    let http = 0;
    let answer: unknown = null;
    try {
      const r = await fetch(cfg.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: raw, signal: AbortSignal.timeout(10_000) });
      http = r.status;
      answer = await r.json().catch(() => null);
    } catch (e) {
      answer = { error: (e as Error).message };
    }
    log({ at: Date.now(), direction: "webhook", summary: `${summary}${n > 1 ? ` (retry ${n - 1})` : ""}`, ok: http === 200, http, request: JSON.parse(raw), response: answer, headers: { "x-hub-signature-256": signature }, phone, status });
    if (http === 200 || http === 401) return http;
    await new Promise((r) => setTimeout(r, 1000 * n));
  }
  return 0;
}

export function webhook(value: Record<string, unknown>, summary: string) {
  const raw = JSON.stringify(envelope(value));
  lastBody = raw;
  const v = value as { statuses?: { recipient_id: string }[]; messages?: { from: string }[] };
  return post(raw, sign(raw), summary, 4, v.statuses?.[0]?.recipient_id ?? v.messages?.[0]?.from, !!v.statuses);
}

/** For judges: the same last webhook again (Meta does this when it misses a 200), and one with a forged signature. */
export const replayLast = () => (lastBody ? post(lastBody, sign(lastBody), "replay of the last webhook (duplicate delivery)", 1) : Promise.resolve(0));
export const forged = () => {
  const raw = lastBody || JSON.stringify(envelope({ statuses: [] }));
  return post(raw, sign(raw, "not-the-app-secret"), "forged webhook (signed with the wrong secret)", 1);
};

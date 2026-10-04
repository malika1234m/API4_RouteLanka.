/**
 * WhatsApp Business Platform (Cloud API) protocol, as pure functions shared by the sender (notifier), the webhook
 * (API) and the Cloud API simulator.
 *
 * Meta's rules this follows:
 *  - A business may start a conversation only with a pre-approved template. Free-form messages (text, reply
 *    buttons) are allowed only inside the 24-hour customer-service window opened by the customer's last message.
 *  - Template text can't start or end with a variable; quick-reply buttons have at most 25 characters and their
 *    payload comes back in the webhook. Interactive reply buttons: at most 3, title at most 20 characters, id at
 *    most 256 characters.
 */
import { renderMessage, toWhatsAppText, tr } from "./i18n";
import type { Lang } from "./contract";
import type { MessageVars } from "./i18n";

export const WA_API_VERSION = "v21.0";
export const WINDOW_HOURS = 24;

/** A stored store message (see services/notifier/src/templates.ts). */
export interface StoreMessage {
  template: string;
  vars?: MessageVars;
  replies?: { label: string; command?: Record<string, unknown>; link?: string }[] | null;
  order_ref?: string | null;
}

/** The templates to submit to Meta for approval (category UTILITY), one per set of reply buttons. */
export const WA_TEMPLATES = {
  routelanka_update: { buttons: [] as string[] },
  routelanka_update_ack: { buttons: ["Noted, thanks"] },
  routelanka_late: { buttons: ["We'll wait", "Send tomorrow"] },
  routelanka_delivered: { buttons: ["All received", "Report a problem"] },
} as const;
export type TemplateName = keyof typeof WA_TEMPLATES;

/** Template body: fixed text around one variable (Meta rejects a variable at the start or the end). */
export const TEMPLATE_BODY = "Waypoint delivery update: {{1}} (RouteLanka)";
/** Meta language codes we publish templates in. */
export const TEMPLATE_LANGS: Record<Lang, string> = { en: "en", si: "si", ta: "ta" };

/** What Meta would be asked to approve: name, language, category, body and buttons, per language. */
export function templateCatalogue() {
  return (Object.keys(WA_TEMPLATES) as TemplateName[]).flatMap((name) =>
    (Object.keys(TEMPLATE_LANGS) as Lang[]).map((lang) => ({
      name,
      language: TEMPLATE_LANGS[lang],
      category: "UTILITY",
      components: [
        { type: "BODY", text: tr(lang, TEMPLATE_BODY), example: { body_text: [[tr(lang, "Your delivery arrives 05:40–06:10 tomorrow on VEH041.")]] } },
        ...(WA_TEMPLATES[name].buttons.length
          ? [{ type: "BUTTONS", buttons: WA_TEMPLATES[name].buttons.map((b) => ({ type: "QUICK_REPLY", text: tr(lang, b) })) }]
          : []),
      ],
    })),
  );
}

// ── Reply payloads ─────────────────────────────────────────────────────────────────────────────────────────────
/** What a reply button does: a store command, or "report" (send the link to the report screen). */
export type ReplyAction = { workspace: string; command: Record<string, unknown> } | { workspace: string; report: string };

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** rl1.<workspace>.<base64url JSON>: under 256 characters, and opaque to the store. */
export function encodeReply(a: ReplyAction): string {
  const body = "command" in a ? { c: a.command } : { r: a.report };
  return `rl1.${a.workspace}.${b64(JSON.stringify(body))}`;
}

export function decodeReply(id: string): ReplyAction | null {
  const m = /^rl1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/.exec(id);
  if (!m) return null;
  try {
    const body = JSON.parse(unb64(m[2])) as { c?: Record<string, unknown>; r?: string };
    if (body.c && typeof body.c.type === "string") return { workspace: m[1], command: body.c };
    if (typeof body.r === "string") return { workspace: m[1], report: body.r };
  } catch {
    /* not ours */
  }
  return null;
}

// ── Outbound payloads ──────────────────────────────────────────────────────────────────────────────────────────
type Button = { title: string; id: string };

/** Button labels too long for a WhatsApp button (20 characters for reply buttons) get a short form. */
const SHORT: Record<string, string> = { "Can't receive, send tomorrow": "Send tomorrow" };

/** The reply buttons of a message, with their payloads. */
export function replyButtons(m: StoreMessage, lang: Lang, workspace: string): Button[] {
  return (m.replies ?? []).map((r) => ({
    title: renderMessage(lang, SHORT[r.label] ?? r.label).replace(/^\p{Extended_Pictographic}️?\s/u, ""),
    id: encodeReply(r.command ? { workspace, command: r.command } : { workspace, report: m.order_ref ?? "" }),
  }));
}

/** Which approved template carries a message with these reply buttons. */
export function templateFor(m: StoreMessage): TemplateName {
  const n = m.replies?.length ?? 0;
  if (n === 0) return "routelanka_update";
  if (m.replies!.some((r) => r.command?.type === "storeReply")) return "routelanka_late";
  if (m.replies!.some((r) => r.command?.type === "receive")) return "routelanka_delivered";
  return "routelanka_update_ack";
}

/** Meta forbids new lines, tabs and runs of more than 4 spaces in template parameters. */
const oneLine = (s: string) => s.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();

/**
 * The Cloud API request body for one store message. Inside the 24-hour window: a free-form message (reply buttons
 * when it has any). Outside it: the approved template, with the rendered message as its variable.
 */
export function buildPayload(m: StoreMessage, to: string, lang: Lang, workspace: string, windowOpen: boolean) {
  const text = toWhatsAppText(renderMessage(lang, m.template, m.vars ?? {}));
  const buttons = replyButtons(m, lang, workspace);
  if (windowOpen) {
    if (!buttons.length) return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } } as const;
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: [...b.title].slice(0, 20).join("") } })) },
      },
    } as const;
  }
  const name = templateFor(m);
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: TEMPLATE_LANGS[lang] },
      components: [
        { type: "body", parameters: [{ type: "text", text: oneLine(text) }] },
        ...buttons.map((b, i) => ({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: b.id }] })),
      ],
    },
  } as const;
}

export type WaPayload = ReturnType<typeof buildPayload>;

// ── Inbound webhooks ───────────────────────────────────────────────────────────────────────────────────────────
export interface WaInbound {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { payload: string; text: string };
  interactive?: { type: string; button_reply?: { id: string; title: string } };
}
export interface WaStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string }[];
}
export interface WaWebhook {
  object: string;
  entry: { id: string; changes: { field: string; value: { messaging_product: string; metadata?: { phone_number_id: string }; messages?: WaInbound[]; statuses?: WaStatus[] } }[] }[];
}

/** The reply id a store's tap carries, for template quick replies and interactive buttons alike. */
export const tappedId = (m: WaInbound) => m.button?.payload ?? m.interactive?.button_reply?.id ?? null;

/** Status only moves forward (a late "delivered" never overwrites "read"). */
export const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** The seeded demo number of an outlet (+94 77 000 0NNN); a deployment can replace it (WHATSAPP_LIVE_NUMBERS). */
export const demoWhatsAppNumber = (outletId: string) => `94770000${outletId.slice(3)}`;
/** 94770000029 -> +94 77 000 0029 */
export const formatPhone = (n: string) => `+${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;

/**
 * Connecting a store's own WhatsApp: the store sends "JOIN <outlet> <code>" to the business number from its phone
 * (a wa.me link fills it in). The message proves the phone is the store's and is its opt-in. "STOP" disconnects.
 */
export const joinText = (outlet: string, code: string) => `JOIN ${outlet} ${code}`;

export function parseJoin(text: string): { outlet: string; code: string } | null {
  const m = text.trim().toUpperCase().match(/^JOIN\s+(OUT\d{3})\s+(\d{6})$/);
  return m ? { outlet: m[1], code: m[2] } : null;
}

export const isStop = (text: string) => /^(STOP|UNSUBSCRIBE)$/i.test(text.trim());

/** A link that opens WhatsApp on the phone with the message ready to send. */
export const waMeLink = (businessNumber: string, text: string) => `https://wa.me/${businessNumber}?text=${encodeURIComponent(text)}`;

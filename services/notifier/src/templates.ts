/**
 * The store's WhatsApp messages, derived from domain events.
 *
 * A message is stored as an English template (also the translation key) plus its values. The web app
 * shows it in the reader's language. A value written as { $t: "chilled" } is itself translated.
 * Reply buttons carry the command they send, so a tap on "We'll wait" is a normal, checked command.
 */
import { REASON_LABEL } from "@routelanka/domain";

export type Tr = { $t: string };
export type Reply = { label: string; command?: Record<string, unknown>; link?: string };
export interface Msg {
  order_ref: string;
  outlet_id: string;
  template: string;
  vars?: Record<string, string | number | Tr | null>;
  direction?: "in" | "out";
  day?: "Yesterday" | "Today";
  at?: string;
  replies?: Reply[];
}

export interface OrderRow {
  order_ref: string;
  outlet_id: string;
  brand: string;
  temp_requirement: string;
  order_units: number;
  decision: string;
  reason: string | null;
  vehicle_id: string | null;
  pred_window: string | null;
  pred_late_prob: number | null;
  window_close_time: string;
  handover_code: string | null;
  reassigned_to: string | null;
  load_flag: { qty: number } | null;
}

const t = (s: string): Tr => ({ $t: s });
export const unit = (o: Pick<OrderRow, "brand">) => t(o.brand === "Fresh" ? "crates" : "units");
export const kind = (o: Pick<OrderRow, "temp_requirement">) => t(o.temp_requirement === "chilled" ? "chilled" : "dry goods");

export const received = (o: OrderRow, day: "Yesterday" | "Today", date: string, at: string): Msg => ({
  order_ref: o.order_ref,
  outlet_id: o.outlet_id,
  day,
  at,
  template: "We received your order {r} ({n} {u}) for {d}. You'll get the arrival time tonight.",
  vars: { r: o.order_ref, n: o.order_units, u: unit(o), d: t(date) },
});

/** On publish: deferral notice with a reply, or the arrival window and the handover code. */
export function published(o: OrderRow): Msg[] {
  if (o.decision === "deferred")
    return [
      {
        order_ref: o.order_ref,
        outlet_id: o.outlet_id,
        template: "Your {k} delivery is **not coming tomorrow morning**. Reason: {r}. It moves to **Saturday 25 April** and you are first in line.",
        vars: { k: kind(o), r: t(REASON_LABEL[o.reason ?? "dispatcher_choice"].toLowerCase()) },
        replies: [{ label: "Noted, thanks", command: { type: "ack", ref: o.order_ref, via: "whatsapp" } }],
      },
    ];
  const late = (o.pred_late_prob ?? 0) >= 0.5;
  return [
    late
      ? { order_ref: o.order_ref, outlet_id: o.outlet_id, template: "Your {k} delivery is expected **{w}**, after your window closes at {c}. Please keep a receiver on until it arrives.", vars: { k: kind(o), w: o.pred_window, c: o.window_close_time } }
      : { order_ref: o.order_ref, outlet_id: o.outlet_id, template: "Your {k} delivery ({n} {u}) arrives **{w}** tomorrow on {v}.", vars: { k: kind(o), n: o.order_units, u: unit(o), w: o.pred_window, v: o.vehicle_id } },
    { order_ref: o.order_ref, outlet_id: o.outlet_id, template: "🔐 Handover code for {r}: **{c}**. Give it to the driver only when the goods are in front of you.", vars: { r: o.order_ref, c: o.handover_code } },
  ];
}

export const sentShort = (o: OrderRow): Msg => ({
  order_ref: o.order_ref,
  outlet_id: o.outlet_id,
  template: "Your {k} delivery will be **{q} {u} short** (not in stock). The balance comes on the next run.",
  vars: { k: kind(o), q: o.load_flag?.qty ?? 0, u: unit(o) },
});

export const departed = (o: OrderRow, at: string): Msg => ({
  order_ref: o.order_ref,
  outlet_id: o.outlet_id,
  template: "🚚 Your delivery left the depot at {t} on {v}. Expected {w}.",
  vars: { t: at, v: o.vehicle_id, w: o.pred_window },
});

export function delayNotice(o: OrderRow, choice: "late" | "move" | "defer", why: string, eta: { from: string; to: string; late: boolean } | null): Msg {
  const base = { order_ref: o.order_ref, outlet_id: o.outlet_id };
  if (choice === "late")
    return {
      ...base,
      template: eta?.late ? "🚧 Your delivery is held up on the way ({r}). New estimate **{w}**. That is after your window closes at {c}." : "🚧 Your delivery is held up on the way ({r}). New estimate **{w}**.",
      vars: { r: t(why), w: eta ? `${eta.from}–${eta.to}` : "", c: o.window_close_time },
      replies: [
        { label: "We'll wait", command: { type: "storeReply", ref: o.order_ref, reply: "wait" } },
        { label: "Can't receive, send tomorrow", command: { type: "storeReply", ref: o.order_ref, reply: "tomorrow" } },
      ],
    };
  if (choice === "move") return { ...base, template: "🚧 Your delivery is held up on the way ({r}), so it now comes on **{v}**. We'll confirm the time when it leaves.", vars: { r: t(why), v: o.reassigned_to } };
  return { ...base, template: "🚧 Your {k} delivery can't reach you before you open ({r}). It goes back to the depot and comes on **tomorrow's first run**; you're first in line.", vars: { k: kind(o), r: t(why) } };
}

/** A stop handed to another vehicle (the dispatcher keeps it inside the store's window). */
export const rerouted = (o: OrderRow, to: string): Msg => ({
  order_ref: o.order_ref,
  outlet_id: o.outlet_id,
  template: "🔁 Your delivery now comes on **{v}** so it reaches you inside your window. We'll confirm the time when it leaves.",
  vars: { v: to },
});

export const storeReplied = (o: OrderRow, reply: "wait" | "tomorrow", at: string): Msg[] => [
  { order_ref: o.order_ref, outlet_id: o.outlet_id, direction: "out", at, template: reply === "wait" ? "We'll wait" : "Can't receive, send tomorrow" },
  { order_ref: o.order_ref, outlet_id: o.outlet_id, at, template: reply === "wait" ? "Thanks. We'll let the driver know you're expecting the delivery." : "Understood. It comes back to the depot and goes first on tomorrow's run." },
];

export const acknowledged = (o: OrderRow, at: string): Msg => ({ order_ref: o.order_ref, outlet_id: o.outlet_id, direction: "out", at, template: "Noted, thanks" });

export function delivered(o: OrderRow, p: { units: number | null; method: string | null; name?: string; deliveredAt: string }): Msg {
  const vars = { t: p.deliveredAt, a: p.units ?? o.order_units, b: o.order_units, u: unit(o), n: p.name ?? "" };
  return {
    order_ref: o.order_ref,
    outlet_id: o.outlet_id,
    template: p.method === "code" ? "📦 Delivered at {t}: {a} of {b} {u}, verified with your handover code. Please check and confirm." : "📦 Delivered at {t}: {a} of {b} {u}, signed by {n}. Please check and confirm.",
    vars,
    replies: [
      { label: "✅ All received", command: { type: "receive", ref: o.order_ref, ok: true } },
      { label: "⚠️ Report a problem", link: `/store/receive/${o.order_ref}` },
    ],
  };
}

export function receipt(o: OrderRow, ok: boolean, issue: { qty?: number; kind?: string } | null, at: string): Msg[] {
  return [
    { order_ref: o.order_ref, outlet_id: o.outlet_id, direction: "out", at, template: ok ? "✅ All received" : "⚠️ Report a problem" },
    ok
      ? { order_ref: o.order_ref, outlet_id: o.outlet_id, at, template: "Thank you. Your receipt is recorded." }
      : { order_ref: o.order_ref, outlet_id: o.outlet_id, at, template: "We've logged {q} × {k}. The dispatcher will arrange a credit or redelivery.", vars: { q: issue?.qty ?? 0, k: t(issue?.kind ?? "") } },
  ];
}

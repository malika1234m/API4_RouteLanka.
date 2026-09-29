"use client";

import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { seed, tripKey } from "./seed";
import type { FieldEvent, LineIssue, Order, OrderState, ReasonCode } from "./types";
import type { Lang } from "./i18n";
import type { DelayReason } from "./roads";

export type Role = "dispatcher" | "loader" | "driver" | "store";

export interface FeedItem {
  id: string;
  at: string;
  role: Role;
  kind: "info" | "issue" | "sync" | "decision";
  text: string;
  ref?: string;
  open?: boolean;
}

export interface DemoState {
  version: number;
  /** Real time (ms) at which the demo clock read 03:00. The demo clock runs 15x real time. */
  clockStart: number;
  published: boolean;
  planVersion: number;
  planChangedAt?: string;
  orders: Order[];
  states: Record<string, OrderState>;
  ready: Record<string, boolean>;
  departed: Record<string, string>;
  feed: FeedItem[];
  driver: {
    online: boolean;
    offlineSince?: string;
    lastContact?: string;
    lastContactStop?: string;
    outbox: FieldEvent[];
    conflicts: { ref: string; to: string }[];
    lastSync?: { at: string; count: number; delivered: number; arrived: number };
    /** A delay the driver reported from the road. Sent by SMS when there is no data signal. */
    delay?: { at: string; reason: DelayReason; minutes: number; via: "sms" | "app"; near: string; smsDone?: { ref: string; at: string }[] };
  };
  /** The dispatcher's choice for each held-up stop, and when the stores were told. */
  delayPlan: Record<string, "late" | "move" | "defer">;
  delayToldAt?: string;
  /** Store replies to a delay notice. */
  storeReplies: Record<string, { reply: "wait" | "tomorrow"; at: string }>;
  placed: Order[];
  /** Language each role has chosen. Field roles often prefer Sinhala or Tamil. */
  lang: Record<Role, Lang>;
  /** Deferral notices the store has acknowledged (order ref → time). */
  acks: Record<string, string>;
  /** Fleet decisions: repairs asked of the workshop, trucks hired for tonight. */
  fleet: { repairs: string[]; hires: { id: string; at: string; district: string; m3: number; cost: number }[] };
}

const KEY = "routelanka-demo-v3";

export function initialState(): DemoState {
  const states: Record<string, OrderState> = {};
  for (const o of seed.orders) states[o.order_ref] = { stage: "ordered", deferred: false };
  return {
    version: 1,
    clockStart: Date.now(),
    published: false,
    planVersion: 1,
    orders: seed.orders.map((o) => ({ ...o })),
    states,
    ready: {},
    departed: {},
    feed: [],
    driver: { online: true, outbox: [], conflicts: [] },
    placed: [],
    lang: { dispatcher: "en", loader: "en", driver: "en", store: "en" },
    acks: {},
    fleet: { repairs: [], hires: [] },
    delayPlan: {},
    storeReplies: {},
  };
}

type Action =
  | { type: "load"; state: DemoState }
  | { type: "reset" }
  | { type: "publish" }
  | { type: "move"; ref: string; vehicle_id: string; trip_id: number }
  | { type: "defer"; ref: string; reason: ReasonCode }
  | { type: "loadTick"; ref: string }
  | { type: "loadUntick"; ref: string }
  | { type: "loadFlag"; ref: string; issue: LineIssue }
  | { type: "shortfallDecision"; ref: string; decision: NonNullable<OrderState["loadDecision"]> }
  | { type: "ready"; key: string }
  | { type: "depart"; key: string }
  | { type: "fieldEvent"; event: FieldEvent }
  | { type: "setOnline"; online: boolean }
  | { type: "reassign"; ref: string; to: string }
  | { type: "ackConflict"; ref: string }
  | { type: "receive"; ref: string; ok: boolean; issue?: LineIssue }
  | { type: "placeOrder"; order: Order }
  | { type: "resolve"; id: string }
  | { type: "setLang"; role: Role; lang: Lang }
  | { type: "ack"; ref: string; via: "whatsapp" | "app" }
  | { type: "repair"; vehicle_id: string; note: string }
  | { type: "hire"; district: string; m3: number; cost: number; note: string }
  | { type: "reportDelay"; reason: DelayReason; minutes: number; near: string; label: string }
  | { type: "planDelay"; plan: Record<string, "late" | "move" | "defer">; moveTo?: string; summary: string }
  | { type: "storeReply"; ref: string; reply: "wait" | "tomorrow" };

const DEMO_START_MIN = 3 * 60;
const SPEED = 15;
let clockStart = Date.now();
/** Demo clock: the run starts at 03:00 and moves 15x faster than real time. */
export const demoNow = (start = clockStart) => {
  const m = DEMO_START_MIN + Math.floor(((Date.now() - start) / 60000) * SPEED);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const now = () => demoNow();
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
/** Demo only: skip the drive. Moves the demo clock forward (never back) to a planned time. */
function skipTo(s: DemoState, hhmm?: string): DemoState {
  if (!hhmm) return s;
  const target = toMin(hhmm);
  const cur = toMin(demoNow(s.clockStart));
  if (target <= cur) return s;
  const start = Date.now() - ((target - DEMO_START_MIN) / SPEED) * 60000;
  clockStart = start;
  return { ...s, clockStart: start };
}
/** Outlet id for an order ref, so messages name the place people know. */
const outletOf = (s: DemoState, ref?: string) => s.orders.find((o) => o.order_ref === ref)?.outlet_id ?? ref;
const uid = () => Math.random().toString(36).slice(2, 10);
const push = (s: DemoState, item: Omit<FeedItem, "id" | "at">): FeedItem[] => [{ id: uid(), at: now(), ...item }, ...s.feed].slice(0, 60);

function patch(s: DemoState, ref: string, p: Partial<OrderState>): Record<string, OrderState> {
  return { ...s.states, [ref]: { ...s.states[ref], ...p } };
}

function applyField(s: DemoState, e: FieldEvent, offline: boolean): DemoState {
  const cur = s.states[e.order_ref];
  const p: Partial<OrderState> =
    e.type === "arrived"
      ? { arrivedAt: e.at }
      : { stage: cur?.stage === "received" ? "received" : "delivered", deliveredAt: e.at, ...e.payload };
  if (offline) {
    p.recordedOffline = true;
    p.syncedAt = now();
  }
  let feed = s.feed;
  // Field facts win: a delivery recorded before the reassignment reached the phone stands.
  if (e.type === "delivered" && cur?.reassignedTo) {
    feed = push(s, { role: "driver", kind: "issue", ref: e.order_ref, open: true, text: `${outletOf(s, e.order_ref)} was delivered by the original driver at ${e.at} before your reassignment reached them. Cancel the stop on ${cur.reassignedTo}.` });
    p.reassignedTo = undefined;
  }
  if (e.type === "delivered" && e.payload?.exception) {
    feed = push({ ...s, feed }, { role: "driver", kind: "issue", ref: e.order_ref, open: true, text: `Driver reported "${e.payload.exception}" at ${outletOf(s, e.order_ref)}` });
  }
  return { ...s, feed, states: patch(s, e.order_ref, p) };
}

function reducer(s: DemoState, a: Action): DemoState {
  clockStart = s.clockStart ?? clockStart;
  switch (a.type) {
    case "load":
      // Resync the demo clock with the saved day, so the next event is stamped correctly.
      clockStart = a.state.clockStart ?? clockStart;
      // Older saved states may lack newer fields.
      return { ...initialState(), ...a.state, clockStart };
    case "reset":
      clockStart = Date.now();
      return initialState();
    case "publish": {
      const states = { ...s.states };
      for (const o of s.orders) states[o.order_ref] = { ...states[o.order_ref], stage: o.decision === "served" ? "planned" : "ordered", deferred: o.decision === "deferred" };
      const nd = s.orders.filter((o) => o.decision === "deferred").length;
      return {
        ...s,
        states,
        published: true,
        planVersion: s.published ? s.planVersion + 1 : s.planVersion,
        planChangedAt: s.published ? now() : undefined,
        feed: push(s, { role: "dispatcher", kind: "decision", text: `Plan published: ${s.orders.length - nd} orders planned, ${nd} deferred with reasons sent to stores` }),
      };
    }
    case "move": {
      const orders = s.orders.map((o) => (o.order_ref === a.ref ? { ...o, decision: "served" as const, reason: undefined, vehicle_id: a.vehicle_id, trip_id: a.trip_id } : o));
      return { ...s, orders, planChangedAt: s.published ? now() : s.planChangedAt, planVersion: s.published ? s.planVersion + 1 : s.planVersion };
    }
    case "defer": {
      const orders = s.orders.map((o) => (o.order_ref === a.ref ? { ...o, decision: "deferred" as const, reason: a.reason, vehicle_id: undefined, trip_id: undefined } : o));
      return { ...s, orders, planChangedAt: s.published ? now() : s.planChangedAt, planVersion: s.published ? s.planVersion + 1 : s.planVersion };
    }
    case "loadTick": {
      // Loading a line clears an undecided flag, but a shortfall the dispatcher has ruled on stays on record.
      const cur = s.states[a.ref];
      return { ...s, states: patch(s, a.ref, { stage: "loaded", loadFlag: cur.loadDecision ? cur.loadFlag : undefined }) };
    }
    case "loadUntick":
      return { ...s, states: patch(s, a.ref, { stage: "planned" }) };
    case "loadFlag":
      return {
        ...s,
        states: patch(s, a.ref, { loadFlag: a.issue, loadDecision: undefined }),
        feed: push(s, { role: "loader", kind: "issue", ref: a.ref, open: true, text: `Dock: ${a.issue.qty} × ${a.issue.kind} for ${outletOf(s, a.ref)}. Decide before the vehicle leaves.` }),
      };
    case "shortfallDecision": {
      const label = { send_short: "Send short", hold: "Hold 15 min for restock", defer_rest: "Defer the remainder" }[a.decision];
      const feed = push(
        { ...s, feed: s.feed.map((f) => (f.ref === a.ref && f.role === "loader" ? { ...f, open: false } : f)) },
        { role: "dispatcher", kind: "decision", ref: a.ref, text: `${label} for ${outletOf(s, a.ref)}. Store notified.` },
      );
      return { ...s, feed, states: patch(s, a.ref, { loadDecision: a.decision, stage: "loaded" }) };
    }
    case "ready":
      return { ...s, ready: { ...s.ready, [a.key]: true } };
    case "depart": {
      // Trucks leave at their planned time: the demo clock skips ahead if the loader finished early.
      s = skipTo(s, seed.trips.find((t) => tripKey(t) === a.key)?.depart);
      const states = { ...s.states };
      for (const o of s.orders) if (tripKey(o) === a.key && o.decision === "served") states[o.order_ref] = { ...states[o.order_ref], stage: "on_road" };
      return { ...s, states, departed: { ...s.departed, [a.key]: now() }, feed: push(s, { role: "loader", kind: "info", text: `${a.key.replace("#", " trip ")} left the dock` }) };
    }
    case "fieldEvent": {
      if (s.driver.outbox.some((e) => e.id === a.event.id)) return s; // idempotent
      let ev = a.event;
      if (ev.type === "arrived") {
        // Demo only: skip the drive to the stop's predicted arrival, and stamp the event then.
        const o = s.orders.find((x) => x.order_ref === ev.order_ref);
        s = skipTo(s, o?.pred_window?.split("-")[0]);
        ev = { ...ev, at: now() };
      }
      if (!s.driver.online) return { ...s, driver: { ...s.driver, outbox: [...s.driver.outbox, ev] } };
      const next = applyField(s, ev, false);
      return { ...next, driver: { ...next.driver, lastContact: ev.at, lastContactStop: ev.order_ref } };
    }
    case "setOnline": {
      if (!a.online) return { ...s, driver: { ...s.driver, online: false, offlineSince: now() } };
      let next: DemoState = { ...s, driver: { ...s.driver, online: true } };
      const sent = s.driver.outbox;
      for (const e of sent) next = applyField(next, e, true);
      const last = sent[sent.length - 1];
      // Stops the dispatcher moved while the phone was offline, which the driver had not reached.
      const conflicts = next.orders
        .filter((o) => (next.states[o.order_ref]?.reassignedTo || next.states[o.order_ref]?.deferredEnRoute) && next.states[o.order_ref].stage !== "delivered")
        .map((o) => ({ ref: o.order_ref, to: next.states[o.order_ref].reassignedTo ?? "depot" }));
      next = {
        ...next,
        driver: {
          ...next.driver,
          outbox: [],
          offlineSince: undefined,
          conflicts,
          lastContact: last?.at ?? next.driver.lastContact,
          lastContactStop: last?.order_ref ?? next.driver.lastContactStop,
          lastSync: { at: now(), count: sent.length, delivered: sent.filter((e) => e.type === "delivered").length, arrived: sent.filter((e) => e.type === "arrived").length },
        },
      };
      if (sent.length) {
        const d = sent.filter((e) => e.type === "delivered").length;
        const ar = sent.length - d;
        next.feed = push(next, { role: "driver", kind: "sync", text: `${seed.personas.driver.vehicle_id} back online: ${d} ${d === 1 ? "delivery" : "deliveries"} and ${ar} arrival ${ar === 1 ? "time" : "times"} synced, with the times they were recorded` });
      }
      return next;
    }
    case "reassign":
      return {
        ...s,
        states: patch(s, a.ref, { reassignedTo: a.to }),
        planVersion: s.planVersion + 1,
        planChangedAt: now(),
        feed: push(s, { role: "dispatcher", kind: "decision", ref: a.ref, text: `${outletOf(s, a.ref)} moved to ${a.to}. The original driver will be told when their phone reconnects.` }),
      };
    case "ackConflict":
      return { ...s, driver: { ...s.driver, conflicts: s.driver.conflicts.filter((c) => c.ref !== a.ref) } };
    case "receive": {
      const feed = a.ok ? push(s, { role: "store", kind: "info", ref: a.ref, text: `${outletOf(s, a.ref)} received in full` }) : push(s, { role: "store", kind: "issue", ref: a.ref, open: true, text: `${outletOf(s, a.ref)} reported ${a.issue?.qty} × ${a.issue?.kind}${a.issue?.note ? `: "${a.issue.note}"` : ""}` });
      return { ...s, feed, states: patch(s, a.ref, { stage: "received", receipt: { ok: a.ok, issue: a.issue } }) };
    }
    case "resolve":
      return { ...s, feed: s.feed.map((f) => (f.id === a.id ? { ...f, open: false } : f)) };
    case "setLang":
      return { ...s, lang: { ...s.lang, [a.role]: a.lang } };
    case "ack":
      if (s.acks[a.ref]) return s;
      return { ...s, acks: { ...s.acks, [a.ref]: now() }, feed: push(s, { role: "store", kind: "info", ref: a.ref, text: `${outletOf(s, a.ref)} acknowledged the deferral${a.via === "whatsapp" ? " on WhatsApp" : ""}` }) };
    case "repair":
      if (s.fleet.repairs.includes(a.vehicle_id)) return s;
      return { ...s, fleet: { ...s.fleet, repairs: [...s.fleet.repairs, a.vehicle_id] }, feed: push(s, { role: "dispatcher", kind: "decision", text: a.note }) };
    case "hire":
      return { ...s, fleet: { ...s.fleet, hires: [...s.fleet.hires, { id: uid(), at: now(), district: a.district, m3: a.m3, cost: a.cost }] }, feed: push(s, { role: "dispatcher", kind: "decision", text: a.note }) };
    case "reportDelay": {
      const via = s.driver.online ? "app" : "sms";
      // With no data signal the SMS also carries a one-line summary of deliveries saved on the phone.
      const smsDone = via === "sms" ? s.driver.outbox.filter((e) => e.type === "delivered").map((e) => ({ ref: e.order_ref, at: e.at })) : [];
      const delay = { at: now(), reason: a.reason, minutes: a.minutes, via, near: a.near, smsDone } as const;
      const also = smsDone.length ? ` Also delivered: ${smsDone.map((d) => `${outletOf(s, d.ref)} at ${d.at}`).join(", ")}.` : "";
      return {
        ...s,
        driver: { ...s.driver, delay },
        feed: push(s, { role: "driver", kind: "issue", open: true, text: `${via === "sms" ? "SMS from" : "Report from"} ${seed.personas.driver.vehicle_id}: ${a.label.toLowerCase()} near ${a.near}, about ${a.minutes} min delay.${also} Decide the remaining stops.` }),
      };
    }
    case "planDelay": {
      const states = { ...s.states };
      for (const [ref, c] of Object.entries(a.plan)) {
        if (c === "move" && a.moveTo) states[ref] = { ...states[ref], reassignedTo: a.moveTo };
        if (c === "defer") states[ref] = { ...states[ref], deferredEnRoute: "road" };
      }
      const feed = push({ ...s, feed: s.feed.map((f) => (f.open && f.role === "driver" && f.text.includes("delay") ? { ...f, open: false } : f)) }, { role: "dispatcher", kind: "decision", text: a.summary });
      return { ...s, states, delayPlan: { ...s.delayPlan, ...a.plan }, delayToldAt: now(), planVersion: s.planVersion + 1, planChangedAt: now(), feed };
    }
    case "storeReply": {
      if (s.storeReplies[a.ref]) return s;
      const states = a.reply === "tomorrow" ? { ...s.states, [a.ref]: { ...s.states[a.ref], deferredEnRoute: "store" as const } } : s.states;
      return {
        ...s,
        states,
        storeReplies: { ...s.storeReplies, [a.ref]: { reply: a.reply, at: now() } },
        feed: push(s, { role: "store", kind: a.reply === "tomorrow" ? "issue" : "info", ref: a.ref, open: a.reply === "tomorrow", text: a.reply === "tomorrow" ? `${outletOf(s, a.ref)} can't receive late: bring it back, deliver on the next run` : `${outletOf(s, a.ref)} will wait for the late delivery` }),
      };
    }
    case "placeOrder":
      return { ...s, placed: [a.order, ...s.placed], feed: push(s, { role: "store", kind: "info", text: `New order ${a.order.order_ref} confirmed for the next run` }) };
  }
}

interface Ctx {
  s: DemoState;
  dispatch: (a: Action) => void;
}
const StoreCtx = createContext<Ctx | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, undefined, initialState);
  const hydrated = useRef(false);
  const fromStorage = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        fromStorage.current = true;
        dispatch({ type: "load", state: JSON.parse(raw) });
      }
    } catch {}
    hydrated.current = true;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        fromStorage.current = true;
        dispatch({ type: "load", state: JSON.parse(e.newValue) });
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (fromStorage.current) {
      fromStorage.current = false;
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s]);

  return <StoreCtx.Provider value={{ s, dispatch }}>{children}</StoreCtx.Provider>;
}

export function useDemo() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useDemo outside DemoProvider");
  return c;
}

export const newEvent = (order_ref: string, type: FieldEvent["type"], payload?: FieldEvent["payload"]): FieldEvent => ({
  id: uid(),
  order_ref,
  type,
  at: now(),
  payload,
});

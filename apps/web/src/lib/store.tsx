"use client";

import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { seed, tripKey } from "./seed";
import type { FieldEvent, LineIssue, Order, OrderState, ReasonCode } from "./types";

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
    lastSync?: { at: string; count: number };
  };
  placed: Order[];
}

const KEY = "routelanka-demo-v2";

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
  | { type: "resolve"; id: string };

const DEMO_START_MIN = 3 * 60;
const SPEED = 15;
let clockStart = Date.now();
/** Demo clock: the run starts at 03:00 and moves 15x faster than real time. */
export const demoNow = (start = clockStart) => {
  const m = DEMO_START_MIN + Math.floor(((Date.now() - start) / 60000) * SPEED);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const now = () => demoNow();
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
      return a.state;
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
    case "loadTick":
      return { ...s, states: patch(s, a.ref, { stage: "loaded", loadFlag: undefined }) };
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
      const states = { ...s.states };
      for (const o of s.orders) if (tripKey(o) === a.key && o.decision === "served") states[o.order_ref] = { ...states[o.order_ref], stage: "on_road" };
      return { ...s, states, departed: { ...s.departed, [a.key]: now() }, feed: push(s, { role: "loader", kind: "info", text: `${a.key.replace("#", " trip ")} left the dock` }) };
    }
    case "fieldEvent": {
      if (s.driver.outbox.some((e) => e.id === a.event.id)) return s; // idempotent
      if (!s.driver.online) return { ...s, driver: { ...s.driver, outbox: [...s.driver.outbox, a.event] } };
      const next = applyField(s, a.event, false);
      return { ...next, driver: { ...next.driver, lastContact: a.event.at, lastContactStop: a.event.order_ref } };
    }
    case "setOnline": {
      if (!a.online) return { ...s, driver: { ...s.driver, online: false, offlineSince: now() } };
      let next: DemoState = { ...s, driver: { ...s.driver, online: true } };
      const sent = s.driver.outbox;
      for (const e of sent) next = applyField(next, e, true);
      const last = sent[sent.length - 1];
      // Stops the dispatcher moved while the phone was offline, which the driver had not reached.
      const conflicts = next.orders
        .filter((o) => next.states[o.order_ref]?.reassignedTo && next.states[o.order_ref].stage !== "delivered")
        .map((o) => ({ ref: o.order_ref, to: next.states[o.order_ref].reassignedTo! }));
      next = {
        ...next,
        driver: {
          ...next.driver,
          outbox: [],
          offlineSince: undefined,
          conflicts,
          lastContact: last?.at ?? next.driver.lastContact,
          lastContactStop: last?.order_ref ?? next.driver.lastContactStop,
          lastSync: { at: now(), count: sent.length },
        },
      };
      if (sent.length) next.feed = push(next, { role: "driver", kind: "sync", text: `${seed.personas.driver.vehicle_id} back online: ${sent.length} records synced (recorded on the phone while offline)` });
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

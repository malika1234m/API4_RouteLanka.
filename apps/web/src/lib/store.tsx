"use client";

/**
 * The client's view of the demo day. State lives on the server: this provider loads the day's view
 * from the API, keeps it fresh from the server-sent event stream, and turns each user action into a
 * command. Screens keep the same `useDemo()` interface they had in the prototype.
 *
 * The driver's phone is the exception that proves the rule: field records go to an IndexedDB outbox
 * first and are sent when there is signal. With no signal (real, or simulated by the demo control)
 * they stay on the phone and the screen shows them from the outbox.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clockStartFor, clockTime, formatDelaySms, toMin, type Command, type DayView, type FieldEvent, type Lang, type LineIssue, type Order, type OrderState, type ReasonCode, type Reference } from "@routelanka/domain";
import { api, ApiError, roleForPath } from "./api";
import { outboxAdd, outboxAll, outboxRemove } from "./outbox";
import { setDay, setReference } from "./seed";
import type { DelayReason } from "./roads";

export type Role = "dispatcher" | "loader" | "driver" | "store";
export type { FeedItem } from "@routelanka/domain";

export type DemoState = Omit<DayView, "driver"> & {
  version: number;
  /** Real time (ms) at which the demo clock read 03:00. */
  clockStart: number;
  driver: DayView["driver"] & { outbox: FieldEvent[] };
};

/** Actions the screens dispatch. Most map one-to-one onto API commands. */
export type Action =
  | Command
  | { type: "reset"; night?: string }
  | { type: "fieldEvent"; event: FieldEvent }
  | { type: "placeOrder"; order: Order }
  | { type: "loadFlag"; ref: string; issue: LineIssue }
  | { type: "defer"; ref: string; reason: ReasonCode }
  | { type: "shortfallDecision"; ref: string; decision: NonNullable<OrderState["loadDecision"]> }
  | { type: "setLang"; role: Role; lang: Lang }
  | { type: "reportDelay"; reason: DelayReason; minutes: number; near: string; label: string };

// ── demo clock ──
let clock = { start: Date.now(), speed: 15, held: true };
/** Demo time. Before the plan is published the night hasn't started and the clock holds at 03:00. */
export const demoNow = (start = clock.start) => (clock.held ? "03:00" : clockTime(start, clock.speed));

const OFFLINE_KEY = "routelanka-driver-offline";
const VIEW_CACHE = "routelanka-view-cache";
const REF_CACHE = "routelanka-ref-cache";
const readLocal = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLocal = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

interface Ctx {
  s: DemoState;
  dispatch: (a: Action) => Promise<void>;
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
}
const StoreCtx = createContext<Ctx | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<DayView | null>(null);
  const [outbox, setOutbox] = useState<FieldEvent[]>([]);
  const [offline, setOffline] = useState(false); // this phone has no signal (real or simulated)
  const [localClock, setLocalClock] = useState<number | null>(null); // clock skips made while offline
  const [error, setError] = useState<string | null>(null);
  const [authNeeded, setAuthNeeded] = useState<Role | null>(null);
  const loading = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    // A change that arrives while a fetch is running may not be in that fetch's answer, so it is not
    // dropped: one more fetch runs as soon as the current one finishes.
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        again.current = false;
        try {
          const v = await api<DayView>("/view");
          setDay(v);
          setView(v);
          writeLocal(VIEW_CACHE, JSON.stringify(v));
        } catch (e) {
          // No connection: the driver keeps working from the last view saved on the phone.
          const cached = readLocal(VIEW_CACHE);
          if (cached && !(e instanceof ApiError)) {
            const v = JSON.parse(cached) as DayView;
            setDay(v);
            setView((cur) => cur ?? v);
          }
          break;
        }
      } while (again.current);
    } finally {
      loading.current = false;
    }
  }, []);

  // First load: reference data, the day, the phone's outbox and signal state.
  useEffect(() => {
    void (async () => {
      setOffline(readLocal(OFFLINE_KEY) === "1");
      setOutbox(await outboxAll().catch(() => []));
      try {
        const r = await api<Reference>("/reference");
        setReference(r);
        writeLocal(REF_CACHE, JSON.stringify(r));
      } catch {
        const cached = readLocal(REF_CACHE);
        if (cached) setReference(JSON.parse(cached));
      }
      await refresh();
    })();
  }, [refresh]);

  // Live updates: any role's change reaches every open screen of this demo day.
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource("/api/stream");
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 120);
      };
      es.addEventListener("change", soon);
      // After a reconnect, catch up on anything sent while the stream was down.
      let first = true;
      es.addEventListener("hello", () => {
        if (!first) soon();
        first = false;
      });
      es.onerror = () => {
        es?.close();
        setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      clearTimeout(timer);
      es?.close();
    };
  }, [refresh]);

  // A real phone losing and regaining signal.
  useEffect(() => {
    const on = () => {
      if (readLocal(OFFLINE_KEY) !== "1") void flush();
    };
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view) clock = { start: localClock ?? view.day.clock_start, speed: view.day.clock_speed, held: !view.published };

  const noSignal = () => offline || (typeof navigator !== "undefined" && !navigator.onLine);

  /** Send everything saved on the phone. Records keep the time they were made. */
  const flush = async () => {
    const events = await outboxAll();
    await api("/sync", { offline: true, events }, "driver");
    await outboxRemove(events.map((e) => e.id));
    setOutbox([]);
    setLocalClock(null);
    await refresh();
  };

  const send = async (cmd: Command | Record<string, unknown>) => {
    await api("/commands", cmd);
    await refresh();
  };

  const dispatch = async (a: Action) => {
    setError(null);
    try {
      switch (a.type) {
        case "reset": {
          // A copy of the walkthrough night, or (with a date) a real night from the history, planned by the engine.
          await api("/day/new", a.night ? { night: a.night } : {});
          // That night's road conditions and other reference data.
          try {
            const r = await api<Reference>("/reference");
            setReference(r);
            writeLocal(REF_CACHE, JSON.stringify(r));
          } catch {}
          writeLocal(OFFLINE_KEY, null);
          setOffline(false);
          await outboxRemove((await outboxAll()).map((e) => e.id));
          setOutbox([]);
          setLocalClock(null);
          await refresh();
          return;
        }
        case "placeOrder": {
          if (!("order" in a)) return send(a);
          const o = a.order;
          await send({ type: "placeOrder", outlet_id: o.outlet_id, lines: [{ temp: o.temp_requirement, units: o.order_units, volume_m3: o.order_volume_m3, weight_kg: o.order_weight_kg }] });
          return;
        }
        case "fieldEvent": {
          let ev = a.event;
          if (noSignal()) {
            if (ev.type === "arrived" && view) {
              // Demo: skip the drive to the stop's predicted arrival, on the phone's own clock.
              const o = view.orders.find((x) => x.order_ref === ev.order_ref);
              const target = o?.pred_window?.split("-")[0];
              if (target && toMin(target) > toMin(demoNow())) setLocalClock(clockStartFor(target, clock.speed));
              ev = { ...ev, at: target && toMin(target) > toMin(demoNow()) ? target : demoNow() };
            }
            await outboxAdd(ev);
            setOutbox(await outboxAll());
            return;
          }
          await api("/sync", { offline: false, events: [ev] }, "driver");
          await refresh();
          return;
        }
        case "setOnline": {
          if (!a.online) {
            // The phone's last contact before the signal drops.
            await send({ type: "setOnline", online: false }).catch(() => {});
            writeLocal(OFFLINE_KEY, "1");
            setOffline(true);
            return;
          }
          writeLocal(OFFLINE_KEY, null);
          setOffline(false);
          await flush();
          return;
        }
        case "reportDelay": {
          if (noSignal() && view) {
            // No data signal: the report goes as an SMS, with the deliveries saved on the phone.
            const body = formatDelaySms({ vehicle_id: view.driver.vehicle_id, reason: a.reason, minutes: a.minutes, near: a.near, done: outbox.filter((e) => e.type === "delivered").map((e) => ({ ref: e.order_ref, at: e.at })) });
            await api("/sms/simulate", { body }, "driver");
            await refresh();
            return;
          }
          await send(a);
          return;
        }
        default:
          await send(a as Command);
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403) && roleForPath()) setAuthNeeded(roleForPath()!);
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  // Each role's screens need that role signed in on this browser.
  useEffect(() => {
    const role = roleForPath();
    if (!role) return;
    api<{ accounts: { role: Role }[] }>("/auth/me", undefined, undefined)
      .then((me) => !me.accounts.some((a) => a.role === role) && setAuthNeeded(role))
      .catch(() => {});
  }, []);

  // Not signed in as this screen's role: go to sign-in and come back.
  useEffect(() => {
    if (!authNeeded) return;
    const next = window.location.pathname + window.location.search;
    window.location.href = `/login?role=${authNeeded}&next=${encodeURIComponent(next)}`;
  }, [authNeeded]);

  if (!view)
    return (
      <div className="grid min-h-dvh place-items-center bg-night text-white">
        <p className="font-cond text-xl">Loading RouteLanka…</p>
      </div>
    );

  const s: DemoState = {
    ...view,
    version: 1,
    clockStart: clock.start,
    driver: { ...view.driver, online: view.driver.online && !offline, offlineSince: offline ? (view.driver.offlineSince ?? demoNow()) : view.driver.offlineSince, outbox },
  };

  return <StoreCtx.Provider value={{ s, dispatch, error, clearError: () => setError(null), refresh }}>{children}</StoreCtx.Provider>;
}

export function useDemo() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useDemo outside DemoProvider");
  return c;
}

export const newEvent = (order_ref: string, type: FieldEvent["type"], payload?: FieldEvent["payload"]): FieldEvent => ({
  id: crypto.randomUUID(),
  order_ref,
  type,
  at: demoNow(),
  payload,
});

"use client";

import { useEffect, useState } from "react";
import { dateLabel } from "@routelanka/domain";
import { Btn, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/store";

const year = (iso: string) => iso.slice(0, 4);
const full = (iso: string) => `${dateLabel("en", iso)} ${year(iso)}`;

/**
 * Which delivery night this browser runs. A new demo day is a fresh copy of the walkthrough night (the README's
 * steps use it), or any real night from the order history: that date's orders for both depots, planned by the engine.
 */
export function NightPicker() {
  const { s, dispatch } = useDemo();
  const [nights, setNights] = useState<{ walkthrough: string | null; history: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"walkthrough" | "history">("walkthrough");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let live = true;
    api<{ walkthrough: string | null; history: string[] }>("/day/nights", undefined, undefined)
      .then((n) => {
        if (!live) return;
        setNights(n);
        setDate(n.history.at(-1) ?? "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const history = nights?.history ?? [];
  const valid = kind === "walkthrough" || history.includes(date);
  const isWalkthrough = !s.day.meta.history_date;
  const plan = s.planJob?.summary;

  const start = async () => {
    setErr("");
    setDone("");
    setBusy(true);
    try {
      await dispatch(kind === "history" ? { type: "reset", night: date } : { type: "reset" });
      setDone(kind === "history" ? `Night of ${full(date)} is ready.` : "A fresh copy of the walkthrough night is ready.");
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4 p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-mute">Delivery night</p>
          <p className="font-semibold">
            {full(s.day.service_date)}
            <span className="font-normal text-mute">{isWalkthrough ? " · the walkthrough night" : " · from the order history"}</span>
          </p>
          {!isWalkthrough && plan && (
            <p className="text-xs text-mute">
              {plan.orders} orders · {plan.served} planned · {plan.deferred} deferred
            </p>
          )}
          {done && <p className="mt-1 text-xs font-semibold text-ok">{done}</p>}
        </div>
        {!open && (
          <Btn type="button" onClick={() => setOpen(true)}>
            Start a new demo day
          </Btn>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <label className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 ${kind === "walkthrough" ? "border-night bg-paper" : "border-line"}`}>
            <input type="radio" name="night" checked={kind === "walkthrough"} onChange={() => setKind("walkthrough")} className="mt-1" />
            <span>
              <span className="block font-semibold">The walkthrough night</span>
              <span className="block text-xs text-mute">{nights?.walkthrough ? full(nights.walkthrough) : "Friday 24 April 2026"}: the peak night the README walkthrough follows step by step.</span>
            </span>
          </label>
          <label className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 ${kind === "history" ? "border-night bg-paper" : "border-line"}`}>
            <input type="radio" name="night" checked={kind === "history"} onChange={() => setKind("history")} className="mt-1" disabled={!history.length} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">A night from the order history</span>
              <span className="block text-xs text-mute">
                That date&apos;s real orders for both depots, planned by the engine. {history.length ? `${history.length} nights, ${full(history[0])} to ${full(history.at(-1)!)}.` : "Loading…"}
              </span>
              {kind === "history" && (
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={date}
                    min={history[0]}
                    max={history.at(-1)}
                    onChange={(e) => setDate(e.target.value)}
                    aria-label="Night from the history"
                    className="h-9 rounded-md border border-line bg-card px-2"
                  />
                  <button type="button" className="text-xs font-semibold underline" onClick={() => setDate(history[Math.floor(Math.random() * history.length)])}>
                    Any night
                  </button>
                  {date && !history.includes(date) && <span className="text-xs font-semibold text-late">No deliveries ran that day (holiday or Sunday).</span>}
                  {date && history.includes(date) && <span className="text-xs text-mute">{dateLabel("en", date, "weekday")}</span>}
                </span>
              )}
            </span>
          </label>
          {err && (
            <p role="alert" className="text-xs font-semibold text-late">
              {err}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Btn type="button" variant="primary" disabled={busy || !valid} onClick={() => void start()}>
              {busy ? (kind === "history" ? "Planning the night…" : "Starting…") : "Start"}
            </Btn>
            <Btn type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Btn>
          </div>
          <p className="text-xs text-mute">A new demo day is yours alone: other people using this site keep their own night.</p>
        </div>
      )}
    </Card>
  );
}

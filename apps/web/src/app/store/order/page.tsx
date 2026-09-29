"use client";

import { useState, useSyncExternalStore } from "react";
import { OutletPicker, useOutlet } from "@/components/OutletPicker";
import { Shell } from "@/components/Shell";
import { Btn, BtnLink, Card, IconCheck, IconChill } from "@/components/ui";
import { outletById, seed } from "@/lib/seed";
import { demoNow, useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";
import { useT } from "@/lib/i18n";

type Line = { key: string; label: string; temp: "chilled" | "ambient"; m3: number; kg: number };
const LINES: Record<string, Line[]> = {
  Fresh: [
    { key: "dry", label: "Dry groceries", temp: "ambient", m3: 0.042, kg: 8 },
    { key: "bev", label: "Beverages", temp: "ambient", m3: 0.045, kg: 11 },
    { key: "dairy", label: "Dairy", temp: "chilled", m3: 0.03, kg: 5.5 },
    { key: "meat", label: "Meat and fish", temp: "chilled", m3: 0.03, kg: 6 },
    { key: "produce", label: "Fruit and vegetables", temp: "chilled", m3: 0.032, kg: 5 },
  ],
  Style: [
    { key: "hang", label: "Hanging garments (rails)", temp: "ambient", m3: 0.9, kg: 45 },
    { key: "carton", label: "Folded cartons", temp: "ambient", m3: 0.12, kg: 9 },
  ],
  Tech: [
    { key: "large", label: "Large appliances", temp: "ambient", m3: 0.7, kg: 70 },
    { key: "small", label: "Small electronics (cartons)", temp: "ambient", m3: 0.08, kg: 6 },
  ],
};

const subscribeClock = (cb: () => void) => {
  const t = setInterval(cb, 30000);
  return () => clearInterval(t);
};

/** Minutes until today's 16:00 cutoff; null during server render. */
function useCountdown() {
  const tick = useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 30000), () => null);
  if (tick === null) return null;
  const now = new Date(tick * 30000);
  const cutoff = new Date(now);
  cutoff.setHours(16, 0, 0, 0);
  return Math.round((cutoff.getTime() - now.getTime()) / 60000);
}

/** Pre-fill from the outlet's orders on the current run, so repeat ordering takes one tap. */
function lastOrderQty(outletId: string, lines: Line[]): Record<string, number> {
  const prev = seed.orders.filter((o) => o.outlet_id === outletId);
  const out: Record<string, number> = {};
  for (const temp of ["ambient", "chilled"] as const) {
    const units = prev.filter((o) => o.temp_requirement === temp).reduce((a, o) => a + o.order_units, 0);
    const ls = lines.filter((l) => l.temp === temp);
    if (!units || !ls.length) continue;
    ls.forEach((l, i) => (out[l.key] = Math.floor(units / ls.length) + (i < units % ls.length ? 1 : 0)));
  }
  return out;
}

export default function PlaceOrder() {
  const { s, dispatch } = useDemo();
  const { t } = useT("store");
  const [outletId, setOutlet] = useOutlet();
  const outlet = outletById.get(outletId)!;
  const lines = LINES[outlet.brand];
  const [qty, setQty] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Order[] | null>(null);
  const mins = useCountdown();
  const open = mins === null || mins > 0;
  const runDay = t(open ? "Saturday 25 April" : "Monday 27 April");

  const submit = () => {
    const made: Order[] = [];
    for (const temp of ["ambient", "chilled"] as const) {
      const ls = lines.filter((l) => l.temp === temp && (qty[l.key] ?? 0) > 0);
      if (!ls.length) continue;
      const units = ls.reduce((s, l) => s + qty[l.key], 0);
      made.push({
        order_ref: `ORD-${outletId.slice(3)}${temp === "chilled" ? "C" : "A"}-${4127 + (s.placed.length + 1) * 613}`,
        outlet_id: outletId,
        brand: outlet.brand,
        district: outlet.district,
        depot: outlet.depot,
        dock_type: outlet.dock_type,
        parking_constraint: outlet.parking_constraint,
        mall_window: outlet.mall_window,
        window_open_time: outlet.window_open_time,
        window_close_time: outlet.window_close_time,
        temp_requirement: temp,
        order_units: units,
        order_volume_m3: +ls.reduce((s, l) => s + l.m3 * qty[l.key], 0).toFixed(3),
        order_weight_kg: +ls.reduce((s, l) => s + l.kg * qty[l.key], 0).toFixed(1),
        deferred_yesterday: 0,
        days_since_last_served: 1,
        decision: "served",
        priority: 0,
      });
    }
    made.forEach((order) => dispatch({ type: "placeOrder", order }));
    setDone(made);
  };

  const total = Object.values(qty).reduce((a, b) => a + b, 0);

  return (
    <Shell width="medium" role="store" who={`${seed.personas.store.name} · ${outlet.brand} ${outlet.district}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-cond text-3xl font-bold">{t("Place order")}</h1>
        <OutletPicker id={outletId} onChange={(id) => { setOutlet(id); setQty({}); setDone(null); }} />
      </div>
      <p className={`mt-2 rounded-md px-3 py-2 font-semibold ${open ? "bg-amber-soft text-hivis-deep" : "bg-paper"}`} role="status">
        {mins === null ? t("Orders close at 16:00.") : open ? t("Orders for {d} close at 16:00, in {h} h {m} min.", { d: runDay, h: Math.floor(mins / 60), m: mins % 60 }) : t("Today's cutoff has passed. This order joins the {d} run.", { d: runDay })}
      </p>

      {done ? (
        <Card className="mt-4 p-5">
          <p className="flex items-center gap-2 text-xl font-semibold text-ok">
            <IconCheck className="size-6" /> {t("Received by Waypoint at {t}", { t: demoNow(s.clockStart) })}
          </p>
          <ul className="mt-3 space-y-1">
            {done.map((o) => (
              <li key={o.order_ref}>
                <span className="font-cond text-lg font-bold">{o.order_ref}</span> · {t(o.temp_requirement === "chilled" ? "Chilled" : "Dry")} · {o.order_units} {t(outlet.brand === "Fresh" ? "crates" : "units")}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-mute">{t("For delivery on {d}. You'll see the arrival window in My deliveries after the plan is published. If anything can't be delivered, you'll be told why and when it will come instead.", { d: runDay })}</p>
          <div className="mt-4 flex gap-2">
            <BtnLink href="/store" variant="primary">
              {t("See my deliveries")}
            </BtnLink>
            <Btn onClick={() => { setDone(null); setQty({}); }}>{t("Place another order")}</Btn>
          </div>
        </Card>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
          {(["ambient", "chilled"] as const).map((temp) => {
            const ls = lines.filter((l) => l.temp === temp);
            if (!ls.length) return null;
            return (
              <Card key={temp} className="p-4">
                <p className="flex items-center gap-2 font-cond text-xl font-semibold">
                  {temp === "chilled" ? (
                    <>
                      <span className="text-chill"><IconChill className="size-5" /></span> {t("Chilled order")}
                    </>
                  ) : outlet.brand === "Fresh" ? (
                    t("Dry goods order")
                  ) : (
                    t("{b} order", { b: outlet.brand })
                  )}
                </p>
                {temp === "chilled" && <p className="text-sm text-mute">{t("Travels separately on a refrigerated vehicle.")}</p>}
                <ul className="mt-3 divide-y divide-line">
                  {ls.map((l) => (
                    <li key={l.key} className="flex items-center gap-3 py-2">
                      <span className="flex-1">{t(l.label)}</span>
                      <Btn className="!h-11 !w-11 sm:!h-9 sm:!w-9" onClick={() => setQty((q) => ({ ...q, [l.key]: Math.max(0, (q[l.key] ?? 0) - 1) }))} aria-label={`Fewer ${l.label}`}>
                        −
                      </Btn>
                      <input
                        inputMode="numeric"
                        aria-label={`${l.label} quantity`}
                        value={qty[l.key] ?? 0}
                        onChange={(e) => setQty((q) => ({ ...q, [l.key]: Math.max(0, parseInt(e.target.value || "0", 10) || 0) }))}
                        className="h-11 w-16 rounded-md border border-line text-center font-cond text-lg sm:h-9"
                      />
                      <Btn className="!h-11 !w-11 sm:!h-9 sm:!w-9" onClick={() => setQty((q) => ({ ...q, [l.key]: (q[l.key] ?? 0) + 1 }))} aria-label={`More ${l.label}`}>
                        +
                      </Btn>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          </div>
          <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
            <Card>
              <p className="border-b border-line px-4 py-2.5 font-cond text-lg font-semibold">{t("Order summary")}</p>
              <ul className="divide-y divide-line text-sm">
                {lines.filter((l) => (qty[l.key] ?? 0) > 0).map((l) => (
                  <li key={l.key} className="flex justify-between px-4 py-1.5">
                    <span>{t(l.label)}</span>
                    <span className="font-cond font-semibold">{qty[l.key]}</span>
                  </li>
                ))}
                {total === 0 && <li className="px-4 py-3 text-mute">{t("Nothing added yet. Use the + buttons, or start from Friday's order.")}</li>}
              </ul>
              <dl className="grid grid-cols-3 gap-px border-t border-line bg-line text-center">
                {[
                  ["Units", total],
                  ["Volume", `${lines.reduce((a, l) => a + l.m3 * (qty[l.key] ?? 0), 0).toFixed(1)} m³`],
                  ["Weight", `${Math.round(lines.reduce((a, l) => a + l.kg * (qty[l.key] ?? 0), 0))} kg`],
                ].map(([k, v]) => (
                  <div key={String(k)} className="bg-card px-2 py-2">
                    <dt className="text-xs text-mute">{t(String(k))}</dt>
                    <dd className="font-cond text-lg font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-2 border-t border-line p-3">
                <p className="text-xs text-mute">{t("Delivery on {d} · receiving window {a}–{b}", { d: runDay, a: outlet.window_open_time, b: outlet.window_close_time })}</p>
                <Btn variant="primary" size="lg" className="w-full" disabled={total === 0} onClick={submit}>
                  {t("Send order")}
                </Btn>
                <Btn className="w-full" onClick={() => setQty(lastOrderQty(outletId, lines))}>
                  {t("Start from Friday's order")}
                </Btn>
                {total > 0 && (
                  <button onClick={() => setQty({})} className="h-9 w-full text-sm text-mute underline">
                    {t("Clear all")}
                  </button>
                )}
              </div>
            </Card>
          </aside>
        </div>
      )}
    </Shell>
  );
}

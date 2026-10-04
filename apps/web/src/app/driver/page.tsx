"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Btn, Card, IconArrow, IconCheck, IconChill, IconNoSignal, IconOutbox, IconSignal, OrderMarks } from "@/components/ui";
import { driverState } from "@/lib/driver";
import { outletById, seed, tripKey } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";
import { SyncChip } from "@/components/SyncChip";
import { useT, type T } from "@/lib/i18n";
import { useState } from "react";
import { DELAY_REASONS, roadToday, type DelayReason } from "@/lib/roads";
import { fromMin } from "@/lib/delay";
import { runKey } from "@/lib/runs";

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const DOCK = { rear_dock: "Rear dock", street: "Curbside unloading", mall_bay: "Shared mall bay" };

/** Wider screens only: the next stop in detail, so a tablet or laptop isn't a narrow strip. */
function NextStop({ stops, next, departed, t }: { stops: Order[]; next?: Order; departed?: string; t: T }) {
  const { s } = useDemo();
  if (!s.published) return null;
  const here = next ? stops.filter((o) => o.stop_seq === next.stop_seq) : [];
  const out = next ? outletById.get(next.outlet_id)! : undefined;
  const crates = stops.reduce((a, o) => a + o.order_units, 0);
  const chilled = stops.filter((o) => o.temp_requirement === "chilled").reduce((a, o) => a + o.order_units, 0);
  const done = stops.filter((o) => ["delivered", "received"].includes(driverState(s, o.order_ref).stage)).length;
  return (
    <aside className="hidden lg:sticky lg:top-24 lg:block" aria-label="Next stop">
      {next && out ? (
        <Card className="border-2 border-night p-5">
          <p className="text-xs text-mute">{t("Next stop")}</p>
          <p className="font-cond text-4xl font-bold leading-tight">{next.outlet_id}</p>
          <p className="text-mute">
            {t("Stop {n}", { n: next.stop_seq })} · {out.district}
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            {[
              ["Window", `${next.window_open_time}–${next.window_close_time}${out.mall_window ? ` (${t("mall bay {w}", { w: out.mall_window })})` : ""}`],
              ["Expected arrival", next.pred_window ?? "—"],
              ["Unloading", t(DOCK[next.dock_type])],
              ["Access", t(next.parking_constraint === "van_only" ? "Van only" : next.parking_constraint === "mall_dock" ? "Mall bay window" : "Any vehicle")],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-mute">{t(k)}</dt>
                <dd className={`text-right font-medium ${k === "Expected arrival" && (next.pred_late_prob ?? 0) >= 0.5 ? "text-late" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-mute">{t("Orders to hand over")}</p>
          <ul className="mt-1 space-y-1">
            {here.map((o) => (
              <li key={o.order_ref} className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-2">
                  <OrderMarks o={o} />
                  {t(o.temp_requirement === "chilled" ? "Chilled" : "Dry")}
                </span>
                <span className="font-cond font-semibold">{o.order_units} {t("crates")}</span>
              </li>
            ))}
          </ul>
          {departed ? (
            <Link href={`/driver/stop/${next.order_ref}`} className="mt-4 flex h-12 items-center justify-center rounded-md bg-hivis font-semibold text-night">
              {t("Open this stop")}
            </Link>
          ) : (
            <p className="mt-4 flex h-12 items-center justify-center rounded-md bg-line text-sm font-semibold text-mute">{t("Opens when the truck leaves the dock")}</p>
          )}
        </Card>
      ) : (
        <Card className="p-5">
          <p className="font-cond text-2xl font-bold">{t("Run complete")}</p>
          <p className="text-mute">{t("Every stop on this run has a delivery record.")}</p>
        </Card>
      )}
      <Card className="mt-3 p-4">
        <p className="text-sm font-semibold">{t("This run")}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {[
            ["Deliveries", t("{a} of {b}", { a: done, b: stops.length })],
            ["Crates", String(crates)],
            ["Chilled crates", String(chilled)],
            ["Left the dock", departed ?? t("Not yet")],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-paper px-3 py-2">
              <dt className="text-xs text-mute">{t(k)}</dt>
              <dd className="font-cond text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </aside>
  );
}

type Stop = { seq: number; orders: Order[] };

/** The driver's one-tap way to say "I'm held up", which works with no data signal. */
function DelayReport({ near, t }: { near: string; t: T }) {
  const { s, dispatch } = useDemo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DelayReason>("road_blocked");
  const [mins, setMins] = useState(60);
  const d = s.driver.delay;
  if (d)
    return (
      <div className="mt-3 rounded-lg border-2 border-hivis bg-amber-soft p-4" role="status">
        <p className="font-semibold">{t("Delay reported at {t}: {r}, about {n} min.", { t: d.at, r: t(DELAY_REASONS.find((r) => r.id === d.reason)!.label).toLowerCase(), n: d.minutes })}</p>
        <p className="mt-1 text-sm">{d.via === "sms" ? t("Sent by SMS, no data signal needed.") : t("Sent.")} {d.toldAt && s.driver.online ? t("The dispatcher has decided your remaining stops; they are updated below.") : t("The dispatcher is deciding your remaining stops. You don't need to call.")}</p>
      </div>
    );
  return (
    <div className="mt-3">
      {!open ? (
        <Btn size="lg" className="w-full border-hivis" onClick={() => setOpen(true)}>
          {t("Held up? Report a delay")}
        </Btn>
      ) : (
        <Card className="space-y-3 border-2 border-hivis p-4">
          <p className="text-lg font-semibold">{t("What's holding you up?")}</p>
          <div className="grid grid-cols-2 gap-2">
            {DELAY_REASONS.map((r) => (
              <Btn key={r.id} size="lg" variant={reason === r.id ? "primary" : "secondary"} aria-pressed={reason === r.id} onClick={() => setReason(r.id)} className="!h-auto min-h-12 py-2 leading-tight">
                {t(r.label)}
              </Btn>
            ))}
          </div>
          <p className="text-lg font-semibold">{t("About how long?")}</p>
          <div className="grid grid-cols-4 gap-2">
            {[30, 60, 90, 120].map((m) => (
              <Btn key={m} size="lg" variant={mins === m ? "primary" : "secondary"} aria-pressed={mins === m} onClick={() => setMins(m)} className="!px-1 whitespace-nowrap">
                {t("{n} min", { n: m })}
              </Btn>
            ))}
          </div>
          {!s.driver.online && <p className="text-sm text-mute">{t("No data signal: this goes as a text message (SMS), which usually gets through.")}</p>}
          <div className="flex gap-2">
            <Btn size="xl" variant="primary" className="flex-1" onClick={() => dispatch({ type: "reportDelay", reason, minutes: mins, near, label: DELAY_REASONS.find((r) => r.id === reason)!.label })}>
              {t("Send to dispatcher")}
            </Btn>
            <Btn size="xl" variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Orders grouped by stop: a driver thinks in places, not order numbers. */
function groupStops(orders: Order[]): Stop[] {
  const m = new Map<number, Order[]>();
  for (const o of orders) m.set(o.stop_seq ?? 0, [...(m.get(o.stop_seq ?? 0) ?? []), o]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([seq, os]) => ({ seq, orders: os }));
}

export default function TodaysRun() {
  const { s, dispatch } = useDemo();
  const { t } = useT("driver");
  const p = seed.personas.driver;
  const k = runKey(s.driver);
  const stops = s.orders.filter((o) => tripKey(o) === k && o.decision === "served").sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0));
  const isDoneO = (o: Order) => ["delivered", "received"].includes(driverState(s, o.order_ref).stage);
  const backO = (o: Order) => !!s.states[o.order_ref].deferredEnRoute && s.driver.online && !isDoneO(o);
  const movedO = (o: Order) => (!!s.states[o.order_ref].reassignedTo && s.driver.online && !isDoneO(o)) || backO(o);
  const next = stops.find((o) => !isDoneO(o) && !s.states[o.order_ref].reassignedTo && !(s.states[o.order_ref].deferredEnRoute && s.driver.online));
  const roadIdx = roadToday(stops[0]?.depot === "Kandy" ? "Kandy" : "Colombo");
  const meta = seed.trips.find((t) => tripKey(t) === k);
  // Stops the dispatcher moved to another vehicle no longer count towards this driver's run.
  const mine = stops.filter((o) => !((s.states[o.order_ref].reassignedTo || s.states[o.order_ref].deferredEnRoute) && s.driver.online));
  const groups = groupStops(stops);
  const nextGroup = next ? groups.find((g) => g.seq === next.stop_seq) : undefined;
  const liveStops = new Set(mine.map((o) => o.stop_seq)).size;
  const loadedCount = stops.filter((o) => s.states[o.order_ref].stage !== "planned").length;

  return (
    <Shell role="driver" width="medium" who={p.name} right={<SyncChip />}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
      <div>
      {!s.driver.online && (
        <div className="-mx-4 -mt-4 mb-4 bg-amber-soft px-4 py-3 hatch-soft" role="status">
          <p className="font-semibold">{t("No signal since {t}. Your work is saved on this phone.", { t: s.driver.offlineSince })}</p>
          <p className="text-sm">{t("Keep delivering as normal. Everything sends by itself when signal returns.")}</p>
        </div>
      )}
      {s.driver.online && s.driver.lastSync && s.driver.lastSync.count > 0 && (
        <p className="-mx-4 -mt-4 mb-4 flex items-center gap-2 bg-ok-soft px-4 py-3 font-semibold text-ok" role="status">
          <IconCheck className="size-5 shrink-0" /> {t("Signal back at {t}. Sent with the times you recorded them: deliveries {d}, arrival times {a}.", { t: s.driver.lastSync.at, d: s.driver.lastSync.delivered ?? s.driver.lastSync.count, a: s.driver.lastSync.arrived ?? 0 })}
        </p>
      )}

      {s.driver.conflicts.map((c) => {
        const o = s.orders.find((x) => x.order_ref === c.ref)!;
        return (
          <Card key={c.ref} className="mb-4 border-2 border-night p-4">
            <p className="text-lg font-semibold">{c.to === "depot" ? t("While you had no signal, the dispatcher sent {o} (stop {n}) back to the depot.", { o: o.outlet_id, n: o.stop_seq }) : t("While you had no signal, the dispatcher moved {o} (stop {n}) to {v}.", { o: o.outlet_id, n: o.stop_seq, v: c.to })}</p>
            <p className="mt-1">{c.to === "depot" ? t("Keep it on the truck and bring it back. The store already knows.") : t("You don't need to go there. Your other deliveries are all saved.")}</p>
            <Btn variant="primary" size="lg" className="mt-3 w-full" onClick={() => dispatch({ type: "ackConflict", ref: c.ref })}>
              {t("Understood")}
            </Btn>
          </Card>
        );
      })}

      <div className="flex items-baseline justify-between gap-2">
        <h1 className="font-cond text-3xl font-bold">
          {p.vehicle_id} · {stops[0]?.district}
        </h1>
        <span className="text-mute">{s.departed[k] ? t("Left {t}", { t: s.departed[k] }) : meta ? t("Leaves {t}", { t: meta.depart }) : ""}</span>
      </div>
      {s.published && (
        <div className="mt-2">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">{t("{a} of {b} deliveries done", { a: mine.filter(isDoneO).length, b: mine.length })}</span>
            <span className="text-mute">{t("{n} stops", { n: liveStops })}</span>
          </div>
          <div className="mt-1 flex gap-[3px]" aria-hidden>
            {mine.map((o) => {
              const d = isDoneO(o);
              return <span key={o.order_ref} className={`h-2 flex-1 rounded-[2px] ${d ? (driverState(s, o.order_ref).pending ? "hatch" : "bg-ok") : o.order_ref === next?.order_ref ? "bg-hivis" : "bg-line"}`} />;
            })}
          </div>
        </div>
      )}
      {!s.published ? (
        <Card className="mt-4 p-4">
          <p className="font-semibold">{t("Your run isn't published yet.")}</p>
          <p className="text-mute">{t("It downloads to this phone as soon as the dispatcher publishes. You won't need signal after that.")}</p>
        </Card>
      ) : (
        <>
          {!s.departed[k] && (
            // Load, release, deliver: the stops open once the loader releases the truck.
            <Card className="mt-3 border-l-4 border-l-hivis p-4">
              <p className="font-semibold">{t("At the dock")}</p>
              <p className="mt-1 text-sm">
                {s.ready[k]
                  ? t("Loaded and checked. Waiting for the loader to release the truck.")
                  : t("{a} of {b} orders loaded. Your stops open when the loader releases the truck.", { a: loadedCount, b: stops.length })}
              </p>
              <div className="mt-2 flex gap-1" aria-hidden>
                {stops.map((o) => (
                  <span key={o.order_ref} className={`h-1.5 flex-1 rounded-sm ${s.states[o.order_ref].stage === "planned" ? "bg-line" : "bg-night"}`} />
                ))}
              </div>
            </Card>
          )}
          {roadIdx < 75 && !s.driver.delay && <p className="mt-2 rounded-md border border-hivis/60 bg-amber-soft px-3 py-2 text-sm font-semibold text-hivis-deep">{t("Roads are slow around {d} today (monsoon, road index {i}). Allow extra time, and report any hold-up below.", { d: stops[0]?.depot, i: roadIdx })}</p>}

          {/* The one thing to do now, big enough to read at arm's length. Wider screens use the side panel. */}
          {next && nextGroup && (
            <Card className="mt-4 overflow-hidden border-2 border-night lg:hidden">
              <div className="bg-night px-4 py-2 text-sm font-semibold text-white">
                {t("Next stop · {a} of {b}", { a: [...new Set(mine.map((o) => o.stop_seq))].indexOf(next.stop_seq) + 1, b: liveStops })}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <p className="font-cond text-4xl font-bold leading-none">{next.outlet_id}</p>
                  <OrderMarks o={next} className="size-6" />
                  <span className="ml-auto text-mute">{next.district}</span>
                </div>
                <p className="mt-2 text-lg font-semibold">{t("Deliver between {a} and {b}", { a: next.window_open_time, b: next.window_close_time })}</p>
                <p className={`text-base ${(next.pred_late_prob ?? 0) >= 0.5 ? "font-semibold text-late" : "text-mute"}`}>
                  {t("You'll arrive about {t}", { t: s.driver.delay && next.pred_arrival ? fromMin(toMinutes(next.pred_arrival) + s.driver.delay.minutes) : next.pred_arrival })}
                  {s.driver.delay ? ` (${t("including the delay")})` : ""}
                  {(next.pred_late_prob ?? 0) >= 0.5 ? ` · ${t("after the window")}` : ""}
                </p>
                <p className="mt-3 text-sm text-mute">{t("Hand over")}</p>
                <ul className="mt-1 space-y-1">
                  {nextGroup.orders.filter((o) => !movedO(o)).map((o) => {
                    const short = s.states[o.order_ref].loadDecision === "send_short" ? s.states[o.order_ref].loadFlag?.qty ?? 0 : 0;
                    return (
                      <li key={o.order_ref} className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 ${isDoneO(o) ? "bg-ok-soft" : "bg-paper"}`}>
                        <span className="inline-flex items-center gap-2 font-semibold">
                          {o.temp_requirement === "chilled" && <span className="text-chill"><IconChill className="size-5" /></span>}
                          {t(o.temp_requirement === "chilled" ? "Chilled" : "Dry")}
                        </span>
                        <span className="whitespace-nowrap font-cond text-xl font-bold">
                          {o.order_units - short} {t("crates")}
                          {short ? <span className="ml-1 font-sans text-sm font-semibold text-late">({t("{n} short", { n: short })})</span> : null}
                          {isDoneO(o) && <IconCheck className="ml-1 inline size-5 text-ok" />}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-sm">
                  <span className="text-mute">{t("Unloading")}:</span> {t(DOCK[next.dock_type])}
                  {next.parking_constraint === "van_only" ? ` · ${t("van access only")}` : ""}
                </p>
                {s.departed[k] ? (
                  <Link href={`/driver/stop/${next.order_ref}`} className="mt-4 flex h-16 items-center justify-center gap-2 rounded-md bg-hivis text-xl font-bold text-night">
                    {t("Start this stop")} <IconArrow className="size-6" />
                  </Link>
                ) : (
                  <p className="mt-4 flex h-16 items-center justify-center rounded-md bg-line px-3 text-center font-semibold text-mute">{t("Opens when the truck leaves the dock")}</p>
                )}
              </div>
            </Card>
          )}

          {s.departed[k] && next && <DelayReport near={`${next.district} (${t("before {o}", { o: next.outlet_id })})`} t={t} />}

          <h2 className="mt-6 font-cond text-xl font-semibold">{t("All stops")}</h2>
          <ol className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
            {groups.map((g) => {
              const live = g.orders.filter((o) => !movedO(o));
              const moved = live.length === 0;
              const done = !moved && live.every(isDoneO);
              const pending = live.some((o) => isDoneO(o) && driverState(s, o.order_ref).pending);
              const isNext = next?.stop_seq === g.seq;
              const o = g.orders[0];
              const out = outletById.get(o.outlet_id)!;
              const doneAt = live.map((x) => driverState(s, x.order_ref).deliveredAt).filter(Boolean).sort().at(-1);
              const crates = (moved ? g.orders : live).reduce((a, x) => a + x.order_units, 0);
              const back = g.orders.filter((x) => backO(x));
              const waits = live.some((x) => s.storeReplies[x.order_ref]?.reply === "wait");
              const late = !done && !moved && g.orders.some((x) => (x.pred_late_prob ?? 0) >= 0.5);
              const firstOpen = live.find((x) => !isDoneO(x)) ?? live[0] ?? o;
              return (
                <li key={g.seq}>
                  <Link href={moved ? "#" : `/driver/stop/${firstOpen.order_ref}`} aria-disabled={moved} className={`flex items-center gap-3 px-3 py-3 ${isNext ? "bg-amber-soft" : ""} ${moved ? "opacity-50" : ""}`}>
                    <span className={`grid size-11 shrink-0 place-items-center rounded-md font-cond text-2xl font-bold ${done ? (pending ? "hatch text-night" : "bg-ok text-white") : isNext ? "bg-hivis text-night" : "bg-paper"}`}>{done ? <IconCheck className="size-6" /> : g.seq}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-cond text-xl font-bold leading-tight">{o.outlet_id}</span>
                        {g.orders.some((x) => x.temp_requirement === "chilled") && <span className="text-chill"><IconChill className="size-4" /></span>}
                      </span>
                      <span className="block text-sm text-mute">
                        {t("Window {a}–{b}", { a: o.window_open_time, b: o.window_close_time })}
                        {out.mall_window && ` · ${t("mall bay {w}", { w: out.mall_window })}`} · {crates} {t("crates")}
                      </span>
                      {s.states[o.order_ref] && g.orders.some((x) => s.states[x.order_ref].loadDecision === "send_short") && !done && (
                        <span className="mt-1 block text-sm font-semibold text-late">{t("{n} crates short: store already told", { n: g.orders.map((x) => s.states[x.order_ref].loadFlag?.qty ?? 0).reduce((a, b) => a + b, 0) })}</span>
                      )}
                      {late && !s.driver.delay && <span className="mt-1 block text-sm font-semibold text-late">{t("Likely after window · est. {t}", { t: o.pred_arrival })}</span>}
                      {!moved && back.length > 0 && <span className="mt-1 block text-sm font-semibold text-late">{t("Bring back to depot")}: {back.map((x) => `${t(x.temp_requirement === "chilled" ? "Chilled" : "Dry")} ${x.order_units}`).join(", ")}</span>}
                      {waits && !done && <span className="mt-1 block text-sm font-semibold text-ok">{t("The store is waiting for you")}</span>}
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold">
                      {moved ? (
                        <span className="text-mute">{g.orders.some((x) => s.states[x.order_ref].deferredEnRoute) ? t("Bring back to depot") : t("Moved to {v}", { v: s.states[o.order_ref].reassignedTo })}</span>
                      ) : done ? (
                        pending ? (
                          <span className="inline-flex items-center gap-1 text-hivis-deep"><IconOutbox className="size-4" /> {t("Saved, will send")}</span>
                        ) : (
                          <span className="text-ok">{t("Done {t}", { t: doneAt })}</span>
                        )
                      ) : isNext ? (
                        <span className="text-night">{t("Next")}</span>
                      ) : (
                        <span className="text-mute">{t("Later")}</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="mt-8 rounded-md border border-dashed border-line p-3">
        <p className="text-xs text-mute">Demo control: simulate losing signal on the hill road</p>
        <Btn size="lg" className="mt-2 w-full" onClick={() => dispatch({ type: "setOnline", online: !s.driver.online })}>
          {s.driver.online ? (
            <>
              <IconNoSignal /> Lose signal
            </>
          ) : (
            <>
              <IconSignal /> Signal returns
            </>
          )}
        </Btn>
      </div>
      </div>
      <NextStop stops={mine} next={next} departed={s.departed[k]} t={t} />
      </div>
    </Shell>
  );
}

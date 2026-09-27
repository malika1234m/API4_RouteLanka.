"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Btn, Card, Chip, IconCheck, IconNoSignal, IconOutbox, IconSignal, OrderMarks } from "@/components/ui";
import { driverState } from "@/lib/driver";
import { outletById, seed, tripKey } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import { SyncChip } from "@/components/SyncChip";

const DOCK = { rear_dock: "Rear dock", street: "Curbside unloading", mall_bay: "Shared mall bay" };

export default function TodaysRun() {
  const { s, dispatch } = useDemo();
  const p = seed.personas.driver;
  const k = `${p.vehicle_id}#${p.trip_id}`;
  const stops = s.orders.filter((o) => tripKey(o) === k && o.decision === "served").sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0));
  const next = stops.find((o) => driverState(s, o.order_ref).stage !== "delivered" && !s.states[o.order_ref].reassignedTo);
  const meta = seed.trips.find((t) => tripKey(t) === k);

  return (
    <Shell role="driver" who={p.name} right={<SyncChip />}>
      {!s.driver.online && (
        <div className="-mx-4 -mt-5 mb-4 bg-amber-soft px-4 py-3 hatch-soft" role="status">
          <p className="font-semibold">No signal since {s.driver.offlineSince}. Your work is saved on this phone.</p>
          <p className="text-sm">Keep delivering as normal. Everything sends by itself when signal returns.</p>
        </div>
      )}
      {s.driver.online && s.driver.lastSync && s.driver.lastSync.count > 0 && (
        <p className="-mx-4 -mt-5 mb-4 flex items-center gap-2 bg-ok-soft px-4 py-3 font-semibold text-ok" role="status">
          <IconCheck /> Signal back at {s.driver.lastSync.at}: {s.driver.lastSync.count} records sent
        </p>
      )}

      {s.driver.conflicts.map((c) => {
        const o = s.orders.find((x) => x.order_ref === c.ref)!;
        return (
          <Card key={c.ref} className="mb-4 border-2 border-night p-4">
            <p className="text-lg font-semibold">While you had no signal, the dispatcher moved {o.outlet_id} (stop {o.stop_seq}) to {c.to}.</p>
            <p className="mt-1">You don&apos;t need to go there. Your other deliveries are all saved.</p>
            <Btn variant="primary" size="lg" className="mt-3 w-full" onClick={() => dispatch({ type: "ackConflict", ref: c.ref })}>
              Understood
            </Btn>
          </Card>
        );
      })}

      <div className="flex items-baseline justify-between gap-2">
        <h1 className="font-cond text-3xl font-bold">
          {p.vehicle_id} · {stops[0]?.district}
        </h1>
        <span className="text-mute">{meta ? `Leaves ${meta.depart}` : ""}</span>
      </div>
      {s.published && (
        <div className="mt-2">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">
              {stops.filter((o) => ["delivered", "received"].includes(driverState(s, o.order_ref).stage)).length} of {stops.length} deliveries done
            </span>
            <span className="text-mute">{new Set(stops.map((o) => o.stop_seq)).size} stops</span>
          </div>
          <div className="mt-1 flex gap-[3px]" aria-hidden>
            {stops.map((o) => {
              const d = ["delivered", "received"].includes(driverState(s, o.order_ref).stage);
              return <span key={o.order_ref} className={`h-2 flex-1 rounded-[2px] ${d ? (driverState(s, o.order_ref).pending ? "hatch" : "bg-ok") : o.order_ref === next?.order_ref ? "bg-hivis" : "bg-line"}`} />;
            })}
          </div>
        </div>
      )}
      {!s.published ? (
        <Card className="mt-4 p-4">
          <p className="font-semibold">Your run isn&apos;t published yet.</p>
          <p className="text-mute">It downloads to this phone as soon as the dispatcher publishes. You won&apos;t need signal after that.</p>
        </Card>
      ) : (
        <>
          {!s.departed[k] && <p className="mt-2 rounded-md bg-paper px-3 py-2 text-sm text-mute">Loading at the dock. The run is already on your phone.</p>}
          <ol className="mt-4 space-y-3">
            {stops.map((o) => {
              const st = driverState(s, o.order_ref);
              const out = outletById.get(o.outlet_id)!;
              const moved = !!s.states[o.order_ref].reassignedTo && s.driver.online && st.stage !== "delivered";
              const done = st.stage === "delivered" || st.stage === "received";
              const isNext = next?.order_ref === o.order_ref;
              return (
                <li key={o.order_ref}>
                  <Link href={moved ? "#" : `/driver/stop/${o.order_ref}`} aria-disabled={moved} className={`block rounded-lg border bg-card p-4 ${isNext ? "border-2 border-night" : "border-line"} ${moved ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-3">
                      <span className={`grid size-11 shrink-0 place-items-center rounded-md font-cond text-2xl font-bold ${done ? "bg-ok text-white" : isNext ? "bg-hivis text-night" : "bg-paper"}`}>{done ? <IconCheck className="size-6" /> : o.stop_seq}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-cond text-2xl font-bold leading-tight">{o.outlet_id}</p>
                        <p className="text-base">
                          Window {o.window_open_time}–{o.window_close_time}
                          {out.mall_window && ` · mall bay ${out.mall_window}`}
                        </p>
                      </div>
                      <OrderMarks o={o} className="size-6" />
                    </div>
                    <p className="mt-2 text-mute">
                      {o.temp_requirement === "chilled" ? "Chilled" : o.brand === "Fresh" ? "Dry" : o.brand} · {o.order_units} {o.brand === "Fresh" ? "crates" : "units"} · {DOCK[o.dock_type]}
                      {o.parking_constraint === "van_only" ? " · van access only" : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.states[o.order_ref].loadDecision === "send_short" && !done && <Chip tone="late">{s.states[o.order_ref].loadFlag?.qty} crates short: store already told</Chip>}
                      {moved && <Chip tone="neutral">Moved to {s.states[o.order_ref].reassignedTo}</Chip>}
                      {done && st.pending && (
                        <Chip tone="hivis">
                          <IconOutbox className="size-3.5" /> Saved, will send
                        </Chip>
                      )}
                      {done && !st.pending && <Chip tone="ok">Delivered {st.deliveredAt}{st.recordedOffline ? " · sent later" : ""}</Chip>}
                      {!done && !moved && (o.pred_late_prob ?? 0) >= 0.5 && <Chip tone="late">Likely after window · est. {o.pred_arrival}</Chip>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="mt-8 rounded-md border border-dashed border-line p-3">
        <p className="text-xs text-mute">Prototype control: simulate coverage on the hill road</p>
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
    </Shell>
  );
}

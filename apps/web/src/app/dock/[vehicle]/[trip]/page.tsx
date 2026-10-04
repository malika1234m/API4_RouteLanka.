"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Btn, BtnLink, Card, IconBack, IconCheck, IconChill, IconFlag, OrderMarks } from "@/components/ui";
import { seed, tripKey, vehicleById } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { LineIssue, Order } from "@/lib/types";
import { useT } from "@/lib/i18n";

const DECISION_TEXT = {
  send_short: "Dispatcher: send short. Load what you have.",
  hold: "Dispatcher: hold 15 min for restock.",
  defer_rest: "Dispatcher: load what you have; the balance goes on the next run.",
};

export default function LoadChecklist() {
  const { vehicle, trip } = useParams<{ vehicle: string; trip: string }>();
  const { s, dispatch } = useDemo();
  const { t } = useT("loader");
  const v = vehicleById.get(vehicle);
  const k = `${vehicle}#${trip}`;
  const orders = s.orders.filter((o) => tripKey(o) === k && o.decision === "served").sort((a, b) => (b.stop_seq ?? 0) - (a.stop_seq ?? 0));
  const meta = seed.trips.find((t) => tripKey(t) === k);
  const resolved = orders.every((o) => s.states[o.order_ref].stage !== "planned" && (!s.states[o.order_ref].loadFlag || s.states[o.order_ref].loadDecision));

  if (!v || !orders.length)
    return (
      <Shell width="medium" role="loader" who={seed.personas.loader.name}>
        <p>{t("This trip is not in the current plan.")}</p>
        <BtnLink href="/dock" className="mt-3">
          {t("Back to dock queue")}
        </BtnLink>
      </Shell>
    );

  return (
    <Shell width="medium" role="loader" who={`${seed.personas.loader.name} · ${v.depot} dock`}>
      <BtnLink href="/dock" variant="ghost" className="-ml-3">
        <IconBack /> {t("Dock queue")}
      </BtnLink>
      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
        <h1 className="font-cond text-4xl font-bold">{v.vehicle_id}</h1>
        <p className="text-lg">
          {t("Trip {n} · {b} · {d} · departs {t}", { n: trip, b: orders[0].brand, d: orders[0].district, t: meta?.depart ?? "—" })}
        </p>
      </div>
      <LoadProgress keyTrip={k} />
      <p className="mt-2 text-mute">{t("Load from position 1. The first item in goes to the last stop, deepest in the vehicle.")}</p>

      <div className="mt-3 grid items-start gap-5 lg:grid-cols-[1fr_300px]">
        <ol className="grid gap-3">
          {orders.map((o, i) => (
            <LoadLine key={o.order_ref} o={o} pos={i + 1} total={orders.length} />
          ))}
        </ol>
        <TruckDiagram orders={orders} capacity={v.volume_cap_m3} />
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-paper px-4 py-3">
        {s.departed[k] ? (
          <p className="text-lg font-semibold text-ok">{t("Left the dock at {t}. The driver has the run on their phone.", { t: s.departed[k] })}</p>
        ) : s.ready[k] ? (
          <Btn variant="primary" size="xl" className="w-full" onClick={() => dispatch({ type: "depart", key: k })}>
            {t("Release vehicle to driver")}
          </Btn>
        ) : (
          <Btn variant="primary" size="xl" className="w-full" disabled={!resolved} onClick={() => dispatch({ type: "ready", key: k })}>
            {t(resolved ? "Mark ready to depart" : "Load or flag every line to continue")}
          </Btn>
        )}
      </div>
    </Shell>
  );
}

/** Where each order sits in the vehicle: position 1 goes in first, against the cab. */
function TruckDiagram({ orders, capacity }: { orders: Order[]; capacity: number }) {
  const { s } = useDemo();
  const { t } = useT("loader");
  const H = 440;
  const used = orders.reduce((a, o) => a + o.order_volume_m3, 0);
  return (
    <aside className="hidden lg:block lg:sticky lg:top-24" aria-label="Loading diagram">
      <Card className="p-4">
        <p className="font-cond text-lg font-semibold">{t("Inside the vehicle")}</p>
        <p className="text-xs text-mute">{t("First in sits against the cab. The last stop is loaded first.")}</p>
        <div className="mx-auto mt-3 w-44">
          <div className="rounded-t-2xl bg-night py-2 text-center text-xs font-semibold text-white">{t("Cab (front)")}</div>
          <div className="flex flex-col gap-[3px] border-x-4 border-night bg-paper p-1" style={{ height: H }}>
            {orders.map((o, i) => {
              const st = s.states[o.order_ref];
              const flagged = st.loadFlag && !st.loadDecision;
              const loaded = st.stage !== "planned" && !flagged;
              const h = Math.max((o.order_volume_m3 / capacity) * (H - 8), 34);
              return (
                <div key={o.order_ref} style={{ height: h }} title={`${i + 1} · ${o.outlet_id} · ${o.order_volume_m3.toFixed(1)} m³`} className={`flex items-center justify-between rounded px-2 text-xs font-semibold ${flagged ? "bg-late text-white" : loaded ? "bg-night text-white" : "border border-dashed border-mute/50 bg-card text-night"}`}>
                  <span className="font-cond text-sm">{i + 1} · {o.outlet_id}</span>
                  <span className="inline-flex items-center gap-1">
                    {o.temp_requirement === "chilled" && <span className={loaded || flagged ? "" : "text-chill"}><IconChill className="size-3.5" /></span>}
                    {o.order_volume_m3.toFixed(1)}
                  </span>
                </div>
              );
            })}
            <div className="flex flex-1 items-center justify-center text-xs text-mute">{t("{n} m³ free", { n: Math.max(capacity - used, 0).toFixed(1) })}</div>
          </div>
          <div className="rounded-b-md bg-night py-2 text-center text-xs font-semibold text-white">{t("Rear doors")}</div>
        </div>
        <div className="mt-3 flex justify-center gap-3 text-xs text-mute">
          <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm border border-dashed border-mute/60 bg-card" /> {t("To load")}</span>
          <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-night" /> {t("Loaded")}</span>
          <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-late" /> {t("Flagged")}</span>
        </div>
      </Card>
    </aside>
  );
}

function LoadProgress({ keyTrip }: { keyTrip: string }) {
  const { s } = useDemo();
  const { t } = useT("loader");
  const os = s.orders.filter((o) => tripKey(o) === keyTrip && o.decision === "served");
  const v = vehicleById.get(keyTrip.split("#")[0])!;
  const done = os.filter((o) => s.states[o.order_ref].stage !== "planned" && !(s.states[o.order_ref].loadFlag && !s.states[o.order_ref].loadDecision));
  const flagged = os.filter((o) => s.states[o.order_ref].loadFlag && !s.states[o.order_ref].loadDecision).length;
  const vol = os.reduce((a, o) => a + o.order_volume_m3, 0);
  return (
    <div className="mt-3 grid grid-cols-3 rl-stats text-center">
      <div className="bg-card px-3 py-2">
        <p className="text-xs text-mute">{t("Loaded")}</p>
        <p className="font-cond text-2xl font-bold">
          {done.length}/{os.length}
        </p>
      </div>
      <div className="bg-card px-3 py-2">
        <p className="text-xs text-mute">{t("Waiting on dispatcher")}</p>
        <p className={`font-cond text-2xl font-bold ${flagged ? "text-late" : ""}`}>{flagged}</p>
      </div>
      <div className="bg-card px-3 py-2">
        <p className="text-xs text-mute">{t("Space used")}</p>
        <p className="font-cond text-2xl font-bold">{Math.round((vol / v.volume_cap_m3) * 100)}%</p>
      </div>
    </div>
  );
}

function LoadLine({ o, pos, total }: { o: Order; pos: number; total: number }) {
  const { s, dispatch } = useDemo();
  const { t } = useT("loader");
  const st = s.states[o.order_ref];
  const [flagging, setFlagging] = useState(false);
  const [kind, setKind] = useState<LineIssue["kind"]>("missing");
  const [qty, setQty] = useState(1);
  const loaded = st.stage !== "planned" && (!st.loadFlag || !!st.loadDecision);
  const waiting = st.loadFlag && !st.loadDecision;

  return (
    <li className="h-full">
      <Card className={`h-full p-4 ${loaded ? "border-ok/50 bg-ok-soft/40" : waiting ? "border-late/60" : ""}`}>
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-night font-cond text-2xl font-bold text-white" aria-label={`Load position ${pos} of ${total}`}>
            {pos}
          </span>
          <div className="min-w-0">
            <p className="font-cond text-2xl font-bold leading-tight">
              {o.outlet_id} <span className="text-lg font-medium text-mute">{t("stop {n}", { n: o.stop_seq })}</span>
            </p>
            <p className="flex items-center gap-2 text-lg">
              {o.order_units} {t(o.brand === "Fresh" ? "crates" : "units")} · {o.order_volume_m3.toFixed(1)} m³ <OrderMarks o={o} className="size-5" />
            </p>
          </div>
          {!flagging && !waiting && (
            <div className="ml-auto flex gap-2">
              <Btn size="lg" variant={loaded ? "secondary" : "primary"} aria-pressed={loaded} onClick={() => dispatch({ type: loaded ? "loadUntick" : "loadTick", ref: o.order_ref })}>
                <IconCheck className="size-5" /> {t(loaded ? "Loaded" : "Load")}
              </Btn>
              <Btn size="lg" variant="danger" onClick={() => setFlagging(true)} aria-label={`Flag a problem with ${o.outlet_id}`}>
                <IconFlag className="size-5" />
              </Btn>
            </div>
          )}
        </div>

        {flagging && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="font-semibold">{t("What's wrong?")}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["missing", "damaged", "temperature"] as const).map((k) => (
                <Btn key={k} size="lg" variant={kind === k ? "primary" : "secondary"} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {t(k === "temperature" ? "Wrong temp" : k[0].toUpperCase() + k.slice(1))}
                </Btn>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="font-semibold">{t("How many?")}</span>
              <Btn size="lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">
                −
              </Btn>
              <span className="w-10 text-center font-cond text-3xl font-bold" aria-live="polite">
                {qty}
              </span>
              <Btn size="lg" onClick={() => setQty((q) => Math.min(o.order_units, q + 1))} aria-label="More">
                +
              </Btn>
              <span className="text-mute">{t("of {n}", { n: o.order_units })}</span>
            </div>
            <div className="mt-4 flex gap-2">
              <Btn size="lg" variant="danger" className="flex-1" onClick={() => { dispatch({ type: "loadFlag", ref: o.order_ref, issue: { kind, qty } }); setFlagging(false); }}>
                {t("Send to dispatcher")}
              </Btn>
              <Btn size="lg" variant="ghost" onClick={() => setFlagging(false)}>
                {t("Cancel")}
              </Btn>
            </div>
          </div>
        )}

        {st.loadFlag && (
          <p className={`mt-3 rounded-md px-3 py-2 text-base ${waiting ? "bg-late-soft text-late" : "bg-paper"}`} role="status">
            {t("{q} × {k} flagged.", { q: st.loadFlag.qty, k: t(st.loadFlag.kind) })}{" "}
            {t(waiting ? "Waiting for the dispatcher. Keep loading the other stops." : DECISION_TEXT[st.loadDecision!])}
          </p>
        )}
      </Card>
    </li>
  );
}

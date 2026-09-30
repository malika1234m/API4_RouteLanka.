"use client";

import { useMemo, useState, type DragEvent } from "react";
import { DepotToggle } from "@/components/DepotToggle";
import { Shell } from "@/components/Shell";
import { Btn, Card, Chip, Meter, OrderMarks } from "@/components/ui";
import { checkMove, DAY_BUDGET, FRESH_BUDGET, loadsFor, vehicleUse, violations } from "@/lib/rules";
import { REASON_LABEL, seed, vehicleById } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order, ReasonCode } from "@/lib/types";

type Filter = "all" | "chilled" | "late" | "repeat";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All orders" },
  { id: "chilled", label: "Chilled" },
  { id: "late", label: "Likely late" },
  { id: "repeat", label: "Skipped recently" },
];

const matches = (o: Order, f: Filter, q: string) =>
  (!q || o.outlet_id.toLowerCase().includes(q) || o.district.toLowerCase().includes(q) || o.order_ref.toLowerCase().includes(q)) &&
  (f === "all" || (f === "chilled" && o.temp_requirement === "chilled") || (f === "late" && (o.pred_late_prob ?? 0) >= 0.5) || (f === "repeat" && (!!o.deferred_yesterday || o.days_since_last_served >= 3)));

type Drop = { vid: string; trip: number } | "defer";
type Dispatch = ReturnType<typeof useDemo>["dispatch"];
type Act = (label: string, a: Parameters<Dispatch>[0]) => void;

export default function PlanBoard() {
  const { s, dispatch } = useDemo();
  const [depot, setDepot] = useState(seed.personas.dispatcher.depot);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  // Undo sends the opposite command: move the order back, or defer it again with its old reason.
  const [undo, setUndo] = useState<{ inverse: Parameters<Dispatch>[0]; label: string } | null>(null);

  const q = query.trim().toLowerCase();
  const orders = s.orders.filter((o) => o.depot === depot);
  const vehicles = seed.vehicles
    .filter((v) => v.depot === depot)
    .sort((a, b) => Number(a.status !== "available") - Number(b.status !== "available") || Number(b.temp === "reefer") - Number(a.temp === "reefer") || Number(b.type === "van") - Number(a.type === "van") || a.vehicle_id.localeCompare(b.vehicle_id));
  const used = vehicles.filter((v) => loadsFor(v, s.orders).length > 0);
  const idle = vehicles.filter((v) => v.status === "available" && loadsFor(v, s.orders).length === 0);
  const workshop = vehicles.filter((v) => v.status !== "available");
  const deferred = orders.filter((o) => o.decision === "deferred").sort((a, b) => b.priority - a.priority);
  const allViolations = vehicles.flatMap((v) => violations(v, s.orders).map((x) => `${v.vehicle_id}: ${x}`));
  const selected = s.orders.find((o) => o.order_ref === sel) ?? null;
  const hits = orders.filter((o) => matches(o, filter, q)).length;

  const reefers = vehicles.filter((v) => v.status === "available" && v.temp === "reefer");
  const reeferLoads = reefers.flatMap((v) => loadsFor(v, s.orders));
  const reeferVolUsed = reeferLoads.reduce((a, l) => a + l.volume, 0);
  const reeferVolCap = reeferLoads.reduce((a, l) => a + vehicleById.get(l.vehicle_id)!.volume_cap_m3, 0);
  const fuel = used.reduce((a, v) => a + vehicleUse(v, loadsFor(v, s.orders)).fuel, 0);
  const lateRisk = orders.filter((o) => o.decision === "served" && (o.pred_late_prob ?? 0) >= 0.5).length;

  const act: Act = (label, a) => {
    const ref = "ref" in a ? a.ref : undefined;
    const before = s.orders.find((o) => o.order_ref === ref);
    if (before)
      setUndo({
        label,
        inverse: before.decision === "served" ? { type: "move", ref: before.order_ref, vehicle_id: before.vehicle_id!, trip_id: before.trip_id! } : { type: "defer", ref: before.order_ref, reason: before.reason ?? "dispatcher_choice" },
      });
    void dispatch(a).catch(() => {});
  };
  const dropCheck = (d: Drop): string[] => (!dragging || d === "defer" ? [] : checkMove(s.orders, dragging, d.vid, d.trip));
  const onDrop = (d: Drop) => {
    if (!dragging) return;
    const o = s.orders.find((x) => x.order_ref === dragging)!;
    if (d === "defer") {
      if (o.decision !== "deferred") act(`Deferred ${o.outlet_id}`, { type: "defer", ref: o.order_ref, reason: "dispatcher_choice" });
    } else if (dropCheck(d).length === 0 && !(o.vehicle_id === d.vid && o.trip_id === d.trip)) {
      act(`Moved ${o.outlet_id} to ${d.vid} trip ${d.trip}`, { type: "move", ref: o.order_ref, vehicle_id: d.vid, trip_id: d.trip });
    }
    setDragging(null);
  };
  const dnd: Dnd = { dragging, setDragging, dropCheck, onDrop, filter, q, sel, setSel };

  const kpis = [
    { k: "Served", v: `${orders.length - deferred.length}`, sub: `of ${orders.length} orders` },
    { k: "Deferred", v: `${deferred.length}`, sub: `${deferred.filter((o) => o.temp_requirement === "chilled").length} chilled`, bad: deferred.length > 0 },
    { k: "Refrigerated load", v: `${reeferVolCap ? Math.round((reeferVolUsed / reeferVolCap) * 100) : 0}%`, sub: `${reeferLoads.length} trips on ${reefers.length} vehicles` },
    { k: "Vehicles used", v: `${used.length}`, sub: `${idle.length} idle · ${workshop.length} in workshop` },
    { k: "Likely late", v: `${lateRisk}`, sub: "stops at 50%+ risk", bad: lateRisk > 0 },
    { k: "Fuel tonight", v: `${Math.round(fuel)} L`, sub: "within weekly quotas" },
  ];

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Plan board</h1>
          <p className="text-sm text-mute">{s.published ? `Published · version ${s.planVersion}${s.planChangedAt ? `, changed ${s.planChangedAt}` : ""}` : "Proposed by the planner. Drag orders to adjust, then publish."}</p>
        </div>
        <DepotToggle depot={depot} onChange={setDepot} />
        {undo && (
          <Btn
            onClick={() => {
              void dispatch(undo.inverse).catch(() => {});
              setUndo(null);
            }}
            title={`Undo: ${undo.label}`}
          >
            Undo
          </Btn>
        )}
        <Btn variant="primary" disabled={allViolations.length > 0} onClick={() => dispatch({ type: "publish" })} title={allViolations.length ? "Fix rule violations first" : undefined}>
          {s.published ? "Publish changes" : "Publish plan"}
        </Btn>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((x) => (
          <div key={x.k} className="bg-card px-3 py-2">
            <dt className="text-xs text-mute">{x.k}</dt>
            <dd className={`font-cond text-2xl font-bold leading-tight ${x.bad ? "text-late" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-mute">{x.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Find an outlet or district</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find outlet or district" className="h-9 w-56 rounded-md border border-line bg-card pl-8 pr-2 text-sm" />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-mute" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
        </label>
        <div role="radiogroup" aria-label="Highlight" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)} className={`h-9 rounded-md border px-3 text-sm font-medium ${filter === f.id ? "border-night bg-night text-white" : "border-line bg-card hover:border-night"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {(filter !== "all" || q) && <span className="text-sm text-mute">{hits} matching orders highlighted</span>}
        <span className="ml-auto hidden text-xs text-mute xl:inline">Drag an order onto a trip or the deferred list. Or select it to see every valid move.</span>
      </div>

      {allViolations.length > 0 && (
        <div className="mt-3 rounded-md border border-late/40 bg-late-soft p-3 text-sm text-late" role="alert">
          <p className="font-semibold">This plan can&apos;t be published. It breaks {allViolations.length} rule{allViolations.length > 1 ? "s" : ""}:</p>
          <ul className="mt-1 list-disc pl-5">{allViolations.slice(0, 5).map((v) => <li key={v}>{v}</li>)}</ul>
        </div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_360px]">
        <section aria-label="Vehicles and trips">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {used.map((v) => (
              <VehicleCard key={v.vehicle_id} vid={v.vehicle_id} orders={s.orders} dnd={dnd} />
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-dashed border-line bg-card/60 p-3">
            <p className="text-sm font-semibold">
              Idle vehicles <span className="font-normal text-mute">· drop an order here to start a new trip</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {idle.map((v) => (
                <DropZone key={v.vehicle_id} target={{ vid: v.vehicle_id, trip: 1 }} dnd={dnd} className="rounded-md border border-line bg-card px-2.5 py-1.5 text-sm">
                  <span className="font-cond font-bold">{v.vehicle_id}</span>{" "}
                  <span className="text-mute">
                    {v.temp === "reefer" ? "refrigerated " : ""}
                    {v.type} · {v.volume_cap_m3} m³
                  </span>
                </DropZone>
              ))}
              {idle.length === 0 && <span className="text-sm text-mute">Every available vehicle is in use.</span>}
            </div>
            {workshop.length > 0 && <p className="mt-2 text-xs text-mute">In workshop, unavailable: {workshop.map((v) => `${v.vehicle_id}${v.temp === "reefer" ? " (refrigerated)" : ""}`).join(", ")}</p>}
          </div>
        </section>

        <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          {selected && <MovePanel o={selected} onClose={() => setSel(null)} act={act} />}
          <DropZone target="defer" dnd={dnd} className="block rounded-lg border border-line bg-card">
            <div className="border-b border-line px-3 py-2">
              <p className="font-cond text-lg font-semibold">Deferred to the next run ({deferred.length})</p>
              <p className="text-xs text-mute">Stores get the reason and the new date when you publish. Drop an order here to defer it.</p>
            </div>
            <ul className="max-h-[calc(100vh-22rem)] divide-y divide-line overflow-y-auto">
              {deferred.map((o) => (
                <li key={o.order_ref}>
                  <OrderRow o={o} dnd={dnd} variant="deferred" />
                </li>
              ))}
              {deferred.length === 0 && <li className="px-3 py-4 text-sm text-mute">Nothing deferred. Every order is on a vehicle.</li>}
            </ul>
          </DropZone>
        </aside>
      </div>
    </Shell>
  );
}

type Dnd = {
  dragging: string | null;
  setDragging: (r: string | null) => void;
  dropCheck: (d: Drop) => string[];
  onDrop: (d: Drop) => void;
  filter: Filter;
  q: string;
  sel: string | null;
  setSel: (r: string | null) => void;
};

function DropZone({ target, dnd, className = "", children }: { target: Drop; dnd: Dnd; className?: string; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const problems = over ? dnd.dropCheck(target) : [];
  const ok = over && problems.length === 0;
  return (
    <div
      onDragOver={(e: DragEvent) => {
        if (!dnd.dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dnd.dropCheck(target).length ? "none" : "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        dnd.onDrop(target);
      }}
      className={`relative transition-shadow ${className} ${over ? (ok ? "ring-2 ring-ok ring-offset-1" : "ring-2 ring-late ring-offset-1") : dnd.dragging ? "ring-1 ring-night/15" : ""}`}
    >
      {children}
      {over && problems.length > 0 && <span className="absolute left-2 right-2 top-full z-20 mt-1 rounded-md bg-late px-2 py-1 text-xs text-white shadow">{problems[0]}</span>}
    </div>
  );
}

function OrderRow({ o, dnd, variant }: { o: Order; dnd: Dnd; variant: "trip" | "deferred" }) {
  const dim = (dnd.filter !== "all" || dnd.q) && !matches(o, dnd.filter, dnd.q);
  const late = (o.pred_late_prob ?? 0) >= 0.5;
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", o.order_ref);
        e.dataTransfer.effectAllowed = "move";
        dnd.setDragging(o.order_ref);
      }}
      onDragEnd={() => dnd.setDragging(null)}
      onClick={() => dnd.setSel(dnd.sel === o.order_ref ? null : o.order_ref)}
      aria-pressed={dnd.sel === o.order_ref}
      className={`group flex w-full cursor-grab items-center gap-2 px-2 py-1.5 text-left text-sm transition-opacity hover:bg-paper active:cursor-grabbing ${dnd.sel === o.order_ref ? "bg-amber-soft" : ""} ${dim ? "opacity-35" : ""} ${dnd.dragging === o.order_ref ? "opacity-50" : ""}`}
    >
      <svg viewBox="0 0 12 16" className="h-3.5 w-2.5 shrink-0 text-line group-hover:text-mute" fill="currentColor" aria-hidden>
        {[2, 7, 12].map((y) => (
          <g key={y}>
            <circle cx="3" cy={y} r="1.3" />
            <circle cx="9" cy={y} r="1.3" />
          </g>
        ))}
      </svg>
      <span className="w-12 font-cond font-semibold">{o.outlet_id}</span>
      <OrderMarks o={o} />
      {variant === "deferred" ? (
        <span className="min-w-0 flex-1 truncate text-mute">
          {o.brand} · {o.district}
        </span>
      ) : (
        <span className="font-cond text-mute">
          {o.window_open_time}–{o.window_close_time}
        </span>
      )}
      {variant === "trip" && late && <Chip tone="late">Late {(o.pred_late_prob ?? 0) >= 0.95 ? ">95" : Math.round((o.pred_late_prob ?? 0) * 100)}%</Chip>}
      {variant === "deferred" && o.deferred_yesterday ? <Chip tone="late">2nd skip</Chip> : null}
      <span className="ml-auto font-cond">{o.order_volume_m3.toFixed(1)} m³</span>
    </button>
  );
}

function VehicleCard({ vid, orders, dnd }: { vid: string; orders: Order[]; dnd: Dnd }) {
  const v = vehicleById.get(vid)!;
  const loads = loadsFor(v, orders);
  const u = vehicleUse(v, loads);
  const bad = violations(v, orders);
  return (
    <Card className={`p-3 ${bad.length ? "border-late" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="font-cond text-xl font-bold">{v.vehicle_id}</span>
        <Chip tone={v.temp === "reefer" ? "chill" : "neutral"}>
          {v.temp === "reefer" ? "Refrigerated" : "Ambient"} {v.type}
        </Chip>
        <span className="ml-auto text-xs text-mute">
          {v.volume_cap_m3} m³ · {v.weight_cap_kg.toLocaleString()} kg
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {loads.some((l) => l.brand === "Fresh") && <Meter label="Fresh window" used={u.fresh} cap={FRESH_BUDGET} unit="min" />}
        {loads.some((l) => l.brand !== "Fresh") && <Meter label="Day window" used={u.day} cap={DAY_BUDGET} unit="min" />}
        <Meter label="Fuel left this week" used={u.fuel} cap={u.fuelLeft} unit="L" />
      </div>
      {loads.map((l) => (
        <DropZone key={l.trip_id} target={{ vid, trip: l.trip_id }} dnd={dnd} className="mt-2 rounded-md border border-line">
          <div className="flex items-baseline gap-2 border-b border-line bg-paper px-2 py-1 text-sm">
            <span className="font-semibold">Trip {l.trip_id}</span>
            <span className="truncate">
              {l.brand} · {l.district}
            </span>
            <span className="ml-auto whitespace-nowrap font-cond text-mute">
              {l.volume.toFixed(1)}/{v.volume_cap_m3} m³ · {Math.round(l.minutes)} min
            </span>
          </div>
          <div>
            {[...l.orders]
              .sort((a, b) => (a.stop_seq ?? 99) - (b.stop_seq ?? 99))
              .map((o) => (
                <OrderRow key={o.order_ref} o={o} dnd={dnd} variant="trip" />
              ))}
          </div>
        </DropZone>
      ))}
      {loads.length < 2 && (
        <DropZone target={{ vid, trip: loads[0]?.trip_id === 1 ? 2 : 1 }} dnd={dnd} className="mt-2 rounded-md border border-dashed border-line px-2 py-1.5 text-center text-xs text-mute">
          Drop here for a second trip
        </DropZone>
      )}
      {bad.length > 0 && <ul className="mt-2 text-sm text-late">{bad.map((b) => <li key={b}>{b}</li>)}</ul>}
    </Card>
  );
}

function MovePanel({ o, onClose, act }: { o: Order; onClose: () => void; act: Act }) {
  const { s } = useDemo();
  const [reason, setReason] = useState<ReasonCode>("dispatcher_choice");
  const options = useMemo(() => {
    const vs = seed.vehicles.filter((v) => v.depot === o.depot && v.status === "available");
    const out: { vid: string; trip: number; label: string; problems: string[] }[] = [];
    for (const v of vs) {
      const loads = loadsFor(v, s.orders);
      const trips = new Set(loads.map((l) => l.trip_id));
      for (const t of [1, 2]) {
        if (o.vehicle_id === v.vehicle_id && o.trip_id === t) continue;
        const l = loads.find((x) => x.trip_id === t);
        if (!l && trips.size >= 2) continue;
        const label = l ? `${v.vehicle_id} trip ${t} · ${l.brand} ${l.district}` : `${v.vehicle_id} · new trip ${t}`;
        out.push({ vid: v.vehicle_id, trip: t, label, problems: checkMove(s.orders, o.order_ref, v.vehicle_id, t) });
        if (!l) break;
      }
    }
    return out.sort((a, b) => a.problems.length - b.problems.length);
  }, [o, s.orders]);
  const ok = options.filter((x) => x.problems.length === 0);
  const blocked = options.filter((x) => x.problems.length > 0);

  return (
    <Card className="toast-in p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="font-cond text-xl font-bold">
            {o.outlet_id} <span className="text-base font-medium text-mute">{o.order_ref}</span>
          </p>
          <p className="text-sm text-mute">
            {o.brand} · {o.district} · {o.temp_requirement} · {o.order_volume_m3.toFixed(2)} m³ · {Math.round(o.order_weight_kg)} kg
          </p>
          {o.decision === "deferred" && (
            <Chip tone="late" className="mt-1">
              {REASON_LABEL[o.reason ?? "dispatcher_choice"]}
            </Chip>
          )}
        </div>
        <button onClick={onClose} className="ml-auto grid size-8 place-items-center rounded-md text-mute hover:bg-paper hover:text-night" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="mt-3 text-sm font-semibold">Move to ({ok.length} valid)</p>
      <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto">
        {ok.map((x) => (
          <li key={x.label}>
            <button onClick={() => act(`Moved ${o.outlet_id} to ${x.vid} trip ${x.trip}`, { type: "move", ref: o.order_ref, vehicle_id: x.vid, trip_id: x.trip })} className="w-full rounded border border-line px-2 py-1.5 text-left text-sm hover:border-night hover:bg-paper">
              {x.label}
            </button>
          </li>
        ))}
        {ok.length === 0 && <li className="rounded-md bg-late-soft px-2 py-1.5 text-sm text-late">No vehicle can take this order without breaking a rule, so this deferral is unavoidable.</li>}
      </ul>
      {blocked.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="text-mute">Why {blocked.length} other trips can&apos;t take it</summary>
          <ul className="mt-1 space-y-1">
            {blocked.slice(0, 8).map((x) => (
              <li key={x.label} className="text-xs">
                <span className="font-semibold">{x.label}</span>: <span className="text-late">{x.problems[0]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {o.decision === "served" && (
        <div className="mt-3 border-t border-line pt-3">
          <label className="text-sm font-semibold" htmlFor="reason">
            Defer instead
          </label>
          <div className="mt-1 flex gap-2">
            <select id="reason" value={reason} onChange={(e) => setReason(e.target.value as ReasonCode)} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-card px-2 text-sm">
              {Object.entries(REASON_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Btn variant="danger" onClick={() => act(`Deferred ${o.outlet_id}`, { type: "defer", ref: o.order_ref, reason })}>
              Defer
            </Btn>
          </div>
          {o.deferred_yesterday ? <p className="mt-1 text-xs text-late">This outlet was skipped yesterday. Deferring again leaves it two runs without delivery.</p> : null}
        </div>
      )}
    </Card>
  );
}

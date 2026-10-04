"use client";

import { DelayDecision, RoadBanner } from "@/components/DelayDecision";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Shell } from "@/components/Shell";
import { Btn, BtnLink, Card, Chip, IconNoSignal } from "@/components/ui";
import { compatibleSwap } from "@/lib/monitor";
import { loadsFor } from "@/lib/rules";
import { offlineRuns, runFor, runKey } from "@/lib/runs";
import { seed, tripKey } from "@/lib/seed";
import { useDemo, type DemoState, type FeedItem } from "@/lib/store";
import type { Order, Vehicle } from "@/lib/types";

type Status = "attention" | "on_road" | "dock" | "done";
type View = "all" | Status;
const VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "All runs" },
  { id: "attention", label: "Needs attention" },
  { id: "on_road", label: "On road" },
  { id: "dock", label: "At dock" },
  { id: "done", label: "Completed" },
];

const isDelivered = (s: DemoState, o: Order) => ["delivered", "received"].includes(s.states[o.order_ref].stage);
const isDone = (s: DemoState, o: Order) => ["delivered", "received"].includes(s.states[o.order_ref].stage) || !!s.states[o.order_ref].reassignedTo;

function runStatus(s: DemoState, k: string, os: Order[]): Status {
  const run = runFor(s, k);
  const offline = !!run && !run.online;
  const flagged = os.some((o) => (s.states[o.order_ref].loadFlag && !s.states[o.order_ref].loadDecision) || s.states[o.order_ref].exception || s.states[o.order_ref].receipt?.issue);
  if (offline || flagged) return "attention";
  if (os.every((o) => isDone(s, o))) return "done";
  if (s.departed[k]) return "on_road";
  return "dock";
}

export default function LiveRuns() {
  const { s } = useDemo();
  const [view, setView] = useState<View>("all");
  const [depot, setDepot] = useState<"all" | "Peliyagoda" | "Kandy">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(() => runKey(s.driver));

  if (!s.published)
    return (
      <Shell role="dispatcher" width="wide">
        <Card className="mx-auto mt-6 max-w-xl p-6 text-center">
          <p className="font-cond text-2xl font-bold">No runs yet</p>
          <p className="mt-1 text-mute">Runs appear here once you publish tonight&apos;s plan. Loaders and drivers see it at the same moment.</p>
          <BtnLink href="/dispatch/plan" variant="primary" className="mt-4">
            Go to plan board
          </BtnLink>
        </Card>
      </Shell>
    );

  const runs = seed.vehicles.flatMap((v) =>
    loadsFor(v, s.orders).map((l) => {
      const k = tripKey(l);
      const orders = [...l.orders].sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0));
      return { v, l, k, orders, status: runStatus(s, k, orders) };
    }),
  );
  const order: Record<Status, number> = { attention: 0, on_road: 1, dock: 2, done: 3 };
  const q = query.trim().toLowerCase();
  const shown = runs
    .filter((r) => (view === "all" || r.status === view) && (depot === "all" || r.v.depot === depot) && (!q || `${r.v.vehicle_id} ${r.l.district} ${r.orders.map((o) => o.outlet_id).join(" ")}`.toLowerCase().includes(q)))
    .sort((a, b) => order[a.status] - order[b.status] || Number(!!runFor(s, b.k)) - Number(!!runFor(s, a.k)) || a.k.localeCompare(b.k));

  const allStops = runs.flatMap((r) => r.orders);
  const delivered = allStops.filter((o) => isDelivered(s, o)).length;
  const lateRisk = allStops.filter((o) => !isDone(s, o) && (o.pred_late_prob ?? 0) >= 0.5).length;
  const openItems = s.feed.filter((f) => f.open);
  const rest = s.feed.filter((f) => !f.open).slice(0, 10);
  const count = (st: Status) => runs.filter((r) => r.status === st).length;
  const noSignal = offlineRuns(s);

  const figures = [
    { k: "Runs tonight", v: runs.length, sub: `${count("dock")} still at the dock` },
    { k: "On road", v: count("on_road") + runs.filter((r) => r.status === "attention" && s.departed[r.k] && runFor(s, r.k) && !runFor(s, r.k)!.online).length, sub: "left the dock" },
    { k: "Deliveries done", v: `${delivered}/${allStops.length}`, sub: `${Math.round((delivered / Math.max(allStops.length, 1)) * 100)}% complete` },
    { k: "Likely late", v: lateRisk, sub: "open stops at 50%+ risk", bad: lateRisk > 0 },
    { k: "No signal", v: noSignal.length, sub: !noSignal.length ? "all phones in contact" : noSignal.length === 1 ? `${noSignal[0].vehicle_id} since ${noSignal[0].offlineSince}` : `${noSignal.map((r) => r.vehicle_id).join(", ")}`, bad: noSignal.length > 0 },
    { k: "Decisions waiting", v: openItems.length, sub: openItems.length ? "see the right-hand panel" : "nothing waiting", bad: openItems.length > 0 },
  ];

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Live runs</h1>
        </div>
        <Legend />
      </div>
      <RoadBanner />

      <dl className="mt-3 grid grid-cols-2 rl-stats sm:grid-cols-3 lg:grid-cols-6">
        {figures.map((x) => (
          <div key={x.k} className="bg-card px-3 py-2">
            <dt className="text-xs text-mute">{x.k}</dt>
            <dd className={`font-cond text-2xl font-bold leading-tight ${x.bad ? "text-late" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-mute">{x.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_370px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1">
              {VIEWS.map((v) => {
                const n = v.id === "all" ? runs.length : count(v.id as Status);
                return (
                  <button key={v.id} role="radio" aria-checked={view === v.id} onClick={() => setView(v.id)} className={`h-9 rounded-md border px-3 text-sm font-medium ${view === v.id ? "border-night bg-night text-white" : "border-line bg-card hover:border-night"}`}>
                    {v.label} <span className={view === v.id ? "text-white/70" : v.id === "attention" && n ? "text-late" : "text-mute"}>{n}</span>
                  </button>
                );
              })}
            </div>
            <select value={depot} onChange={(e) => setDepot(e.target.value as typeof depot)} aria-label="Depot" className="h-9 rounded-md border border-line bg-card px-2 text-sm">
              <option value="all">Both depots</option>
              <option>Peliyagoda</option>
              <option>Kandy</option>
            </select>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Vehicle, district or outlet" aria-label="Search runs" className="ml-auto h-9 w-52 rounded-md border border-line bg-card px-3 text-sm" />
          </div>

          <Card className="mt-3 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper text-left text-xs text-mute">
                <tr>
                  <th className="w-8" aria-label="Expand" />
                  <th className="px-2 py-2 font-medium">Vehicle</th>
                  <th className="px-2 py-2 font-medium">Run</th>
                  <th className="px-2 py-2 font-medium">Stops</th>
                  <th className="px-2 py-2 font-medium">Progress</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <RunRow key={r.k} r={r} expanded={open === r.k} onToggle={() => setOpen(open === r.k ? null : r.k)} />
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-mute">
                      No runs match this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          <div className="flex items-center justify-between">
            <p className="font-cond text-lg font-semibold">Needs a decision</p>
            {openItems.length > 0 && <span className="grid min-w-6 place-items-center rounded-full bg-late px-1.5 text-xs font-bold text-white">{openItems.length}</span>}
          </div>
          {openItems.length === 0 && (
            <Card className="p-4 text-sm text-mute">Nothing waiting. Shortfalls from the dock and problems reported by drivers and stores land here, each with the choices you have.</Card>
          )}
          {openItems.map((f) => (
            <DecisionCard key={f.id} f={f} />
          ))}
          {rest.length > 0 && (
            <Card>
              <p className="border-b border-line px-3 py-2 text-sm font-semibold">Recent activity</p>
              <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
                {rest.map((f) => (
                  <li key={f.id} className="flex gap-2 px-3 py-1.5">
                    <span className="w-11 shrink-0 font-cond text-mute">{f.at}</span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </Shell>
  );
}

function Legend() {
  const dot = (c: string, l: string) => (
    <span className="inline-flex items-center gap-1">
      <span className={`size-3 rounded-sm ${c}`} />
      {l}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-3 text-xs text-mute">
      {dot("bg-line", "Planned")}
      {dot("bg-night", "Loaded / on road")}
      {dot("bg-ok", "Delivered")}
      {dot("bg-late", "Issue")}
      {dot("border-2 border-late bg-card", "Predicted late")}
      {dot("hatch-soft border border-hivis", "No signal")}
    </div>
  );
}

const STATUS_CHIP: Record<Status, React.ReactNode> = {
  attention: <Chip tone="late">Needs attention</Chip>,
  on_road: <Chip tone="night">On road</Chip>,
  dock: <Chip>At dock</Chip>,
  done: <Chip tone="ok">Completed</Chip>,
};

function RunRow({ r, expanded, onToggle }: { r: { v: Vehicle; k: string; orders: Order[]; status: Status; l: { trip_id: number; brand?: string; district?: string } }; expanded: boolean; onToggle: () => void }) {
  const { s, dispatch } = useDemo();
  const { v, k, orders } = r;
  const run = runFor(s, k);
  const offline = !!run && !run.online;
  const lastIdx = offline ? orders.findIndex((o) => o.order_ref === run.lastContactStop) : -1;
  const mine = orders.filter((o) => !s.states[o.order_ref].reassignedTo);
  const done = mine.filter((o) => isDelivered(s, o)).length;
  const next = orders.find((o) => !isDone(s, o));
  const meta = seed.trips.find((t) => tripKey(t) === k);

  const dotClass = (o: Order, i: number) => {
    const st = s.states[o.order_ref];
    const unknown = offline && i > lastIdx && !["delivered", "received"].includes(st.stage);
    if (unknown) return "hatch-soft border border-hivis text-night";
    if ((st.loadFlag && !st.loadDecision) || st.exception || st.receipt?.issue) return "bg-late text-white";
    if (st.stage === "delivered" || st.stage === "received") return "bg-ok text-white";
    if (st.stage === "loaded" || st.stage === "on_road") return "bg-night text-white";
    return "bg-line text-night";
  };

  return (
    <Fragment>
      <tr className={`cursor-pointer border-t border-line align-middle hover:bg-paper/70 ${offline ? "bg-amber-soft/60" : ""} ${expanded ? "bg-paper/70" : ""}`} onClick={onToggle}>
        <td className="pl-3">
          <button aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} stops for ${v.vehicle_id} trip ${r.l.trip_id}`} onClick={(e) => { e.stopPropagation(); onToggle(); }} className="grid size-6 place-items-center rounded text-mute hover:bg-line">
            <svg viewBox="0 0 20 20" className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`} fill="currentColor" aria-hidden>
              <path d="M7 5l6 5-6 5z" />
            </svg>
          </button>
        </td>
        <td className="px-2 py-2">
          <span className="font-cond text-base font-bold">{v.vehicle_id}</span>
          <span className="block text-xs text-mute">
            {v.temp === "reefer" ? "Refrigerated" : "Ambient"} {v.type} · {v.depot}
          </span>
        </td>
        <td className="px-2 py-2">
          Trip {r.l.trip_id} · {r.l.brand} · {r.l.district}
          <span className="mt-0.5 flex items-center gap-2 text-xs text-mute">
            {STATUS_CHIP[r.status]}
            {s.departed[k] ? `Left ${s.departed[k]}` : s.ready[k] ? "Ready" : `Departs ${meta?.depart ?? "—"}`}
          </span>
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-wrap gap-1">
            {orders.map((o, i) => {
              const st = s.states[o.order_ref];
              const late = (o.pred_late_prob ?? 0) >= 0.5 && !isDone(s, o);
              return (
                <span key={o.order_ref} title={`${o.outlet_id} · stop ${o.stop_seq}${late ? ` · ${Math.round((o.pred_late_prob ?? 0) * 100)}% likely late` : ""}${st.reassignedTo ? ` · moved to ${st.reassignedTo}` : ""}`} className={`grid h-6 min-w-8 place-items-center rounded-sm px-1 font-cond text-xs ${dotClass(o, i)} ${late ? "ring-2 ring-late ring-offset-1" : ""} ${st.reassignedTo ? "opacity-40 line-through" : ""}`}>
                  {o.outlet_id.slice(3)}
                </span>
              );
            })}
          </div>
        </td>
        <td className="px-2 py-2">
          <div className="w-28">
            <div className="flex justify-between text-xs">
              <span className="font-semibold">
                {done}/{mine.length}
              </span>
              <span className="text-mute">{next ? `next ${next.outlet_id}` : "done"}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-line">
              <div className="h-full bg-ok" style={{ width: `${(done / Math.max(mine.length, 1)) * 100}%` }} />
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-xs">
          {offline ? (
            <span className="inline-flex items-center gap-1 font-semibold text-hivis-deep">
              <IconNoSignal className="size-4" /> No signal since {run?.offlineSince}
            </span>
          ) : run?.lastSync ? (
            <span className="text-mute">Synced {run.lastSync.at}</span>
          ) : run?.lastContact ? (
            <span className="text-mute">Check-in {run.lastContact}</span>
          ) : (
            <span className="text-mute">{s.departed[k] ? "In contact" : "—"}</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-line/60 bg-paper/50">
          <td />
          <td colSpan={5} className="px-2 pb-3 pt-1">
            {offline && (
              <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-hivis bg-amber-soft px-3 py-2 text-sm">
                <span>
                  Last contact {run?.lastContact ?? s.departed[k] ?? "at the dock"}
                  {lastIdx >= 0 ? ` at stop ${orders[lastIdx].stop_seq}` : ""}. Records will arrive when the phone reconnects.
                </span>
                {run?.delay ? <span className="font-semibold">SMS {run.delay.at}: held up about {run.delay.minutes} min. Decide the stops in the right-hand panel.</span> : <ReassignLast orders={orders} vid={v.vehicle_id} dispatch={dispatch} />}
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-mute">
                <tr>
                  <th className="py-1 pr-2 font-medium">Stop</th>
                  <th className="px-2 py-1 font-medium">Outlet</th>
                  <th className="px-2 py-1 font-medium">Window</th>
                  <th className="px-2 py-1 font-medium">Plan</th>
                  <th className="px-2 py-1 font-medium">Predicted</th>
                  <th className="px-2 py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = s.states[o.order_ref];
                  const late = !st.reassignedTo && (o.pred_late_prob ?? 0) >= 0.5;
                  return (
                    <tr key={o.order_ref} className={`border-t border-line/50 ${st.reassignedTo ? "text-mute" : ""}`}>
                      <td className="py-1 pr-2 font-cond">{o.stop_seq}</td>
                      <td className="px-2 py-1">
                        <span className="font-cond font-semibold">{o.outlet_id}</span> <span className="text-mute">{o.brand === "Fresh" ? (o.temp_requirement === "chilled" ? "chilled" : "dry") : o.brand} · {o.order_units} {o.brand === "Fresh" ? "crates" : "units"}</span>
                      </td>
                      <td className="px-2 py-1 font-cond">
                        {o.window_open_time}–{o.window_close_time}
                      </td>
                      <td className="px-2 py-1 font-cond">{o.plan_arrival}</td>
                      <td className={`px-2 py-1 font-cond ${late ? "font-semibold text-late" : ""}`}>
                        {o.pred_arrival}
                        {late ? ` · ${(o.pred_late_prob ?? 0) >= 0.95 ? ">95" : Math.round((o.pred_late_prob ?? 0) * 100)}% late` : ""}
                      </td>
                      <td className="px-2 py-1">
                        {st.reassignedTo ? (
                          <Chip>Moved to {st.reassignedTo}</Chip>
                        ) : st.receipt ? (
                          <Chip tone={st.receipt.ok ? "ok" : "late"}>{st.receipt.ok ? "Received" : "Issue reported"}</Chip>
                        ) : st.stage === "delivered" ? (
                          <Chip tone="ok">Delivered {st.deliveredAt}</Chip>
                        ) : st.loadFlag && !st.loadDecision ? (
                          <Chip tone="late">Flagged at dock</Chip>
                        ) : st.loadDecision === "send_short" ? (
                          <Chip tone="hivis">Sent short</Chip>
                        ) : (
                          <span className="text-xs text-mute">{st.stage === "on_road" ? "On the way" : st.stage === "loaded" ? "Loaded" : "Planned"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function ReassignLast({ orders, vid, dispatch }: { orders: Order[]; vid: string; dispatch: ReturnType<typeof useDemo>["dispatch"] }) {
  const { s } = useDemo();
  const last = [...orders].reverse().find((o) => s.states[o.order_ref].stage !== "delivered" && !s.states[o.order_ref].reassignedTo);
  if (!last) return null;
  const to = compatibleSwap(last, vid);
  if (!to) return null;
  return (
    <Btn onClick={() => dispatch({ type: "reassign", ref: last.order_ref, to })}>
      Move last stop ({last.outlet_id}) to {to}
    </Btn>
  );
}

function DecisionCard({ f }: { f: FeedItem }) {
  const { s, dispatch } = useDemo();
  if (f.role === "driver" && f.text.includes("delay")) {
    // "Report from VEH041: …" or "SMS from VEH041: …"
    const vid = /^(?:Report|SMS) from (\S+):/.exec(f.text)?.[1];
    if (vid && s.drivers.some((r) => r.vehicle_id === vid && r.delay)) return <DelayDecision vid={vid} />;
  }
  const o = s.orders.find((x) => x.order_ref === f.ref);
  const st = f.ref ? s.states[f.ref] : undefined;
  if (f.role === "loader" && o && st?.loadFlag) {
    const later = new Set(s.orders.filter((x) => tripKey(x) === tripKey(o) && (x.stop_seq ?? 0) >= (o.stop_seq ?? 0)).map((x) => x.stop_seq)).size;
    const opts = [
      { d: "send_short" as const, t: "Send short", sub: `${o.outlet_id} gets ${Math.max(o.order_units - st.loadFlag.qty, 0)} of ${o.order_units} ${o.brand === "Fresh" ? "crates" : "units"}, balance next run` },
      { d: "hold" as const, t: "Hold 15 min for restock", sub: `${later} stop${later > 1 ? "s" : ""} arrive about 15 min later` },
      { d: "defer_rest" as const, t: "Defer the missing items", sub: "Recorded with a reason; the store is told the new date" },
    ];
    return (
      <Card className="border-l-4 border-l-late p-3">
        <p className="text-xs text-mute">{f.at} · from the dock</p>
        <p className="mt-1 font-semibold">
          {o.outlet_id}: {st.loadFlag.qty} × {st.loadFlag.kind}
        </p>
        <p className="text-sm text-mute">
          {o.vehicle_id} trip {o.trip_id} is waiting at the dock. Pick one; the loader and store see it immediately.
        </p>
        <div className="mt-2 grid gap-1.5">
          {opts.map((x) => (
            <button key={x.d} onClick={() => dispatch({ type: "shortfallDecision", ref: o.order_ref, decision: x.d })} className="rounded-md border border-line bg-card px-3 py-2 text-left hover:border-night hover:bg-paper">
              <span className="block text-sm font-semibold">{x.t}</span>
              <span className="block text-xs text-mute">{x.sub}</span>
            </button>
          ))}
        </div>
      </Card>
    );
  }
  return (
    <Card className="border-l-4 border-l-late p-3">
      <p className="text-xs text-mute">
        {f.at} · from the {f.role === "store" ? "store" : f.role}
      </p>
      <p className="mt-1 text-sm">{f.text}</p>
      {st?.receipt?.issue && (
        <Chip tone="late" className="mt-2">
          Credit or redelivery needed
        </Chip>
      )}
      <div className="mt-2 flex gap-2">
        <Btn onClick={() => dispatch({ type: "resolve", id: f.id })}>Mark handled</Btn>
        {f.ref && (
          <Link href="/dispatch/plan" className="inline-flex h-9 items-center px-2 text-sm font-semibold underline">
            Open in plan
          </Link>
        )}
      </div>
    </Card>
  );
}

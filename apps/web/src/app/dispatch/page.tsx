"use client";

import { useState } from "react";
import { DepotToggle } from "@/components/DepotToggle";
import { dateLabel } from "@routelanka/domain";
import { Shell } from "@/components/Shell";
import { BtnLink, Card, Chip, Meter, OrderMarks } from "@/components/ui";
import { seed } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";

type Filter = "all" | "chilled" | "van" | "mall" | "repeat";
const FILTERS: { id: Filter; label: string; test: (o: Order) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "chilled", label: "Chilled", test: (o) => o.temp_requirement === "chilled" },
  { id: "van", label: "Van only", test: (o) => o.parking_constraint === "van_only" },
  { id: "mall", label: "Mall window", test: (o) => o.parking_constraint === "mall_dock" },
  { id: "repeat", label: "Skipped recently", test: (o) => !!o.deferred_yesterday || o.days_since_last_served >= 3 },
];

type SortKey = "outlet_id" | "brand" | "district" | "order_units" | "order_volume_m3" | "order_weight_kg" | "window_close_time" | "days_since_last_served";
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "outlet_id", label: "Outlet" },
  { key: "brand", label: "Brand" },
  { key: "district", label: "District" },
  { key: "order_units", label: "Units", num: true },
  { key: "order_volume_m3", label: "m³", num: true },
  { key: "order_weight_kg", label: "kg", num: true },
  { key: "window_close_time", label: "Window" },
  { key: "days_since_last_served", label: "Last served" },
];

export default function OrderQueue() {
  const { s } = useDemo();
  const [depot, setDepot] = useState(seed.personas.dispatcher.depot);
  const [filter, setFilter] = useState<Filter>("all");
  const [brand, setBrand] = useState<"all" | "Fresh" | "Style" | "Tech">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "district", dir: 1 });

  const orders = s.orders.filter((o) => o.depot === depot);
  const fleet = seed.vehicles.filter((v) => v.depot === depot);
  const avail = fleet.filter((v) => v.status === "available");
  const reefers = avail.filter((v) => v.temp === "reefer");
  const vans = avail.filter((v) => v.type === "van");
  const sum = (xs: Order[], k: "order_volume_m3" | "order_weight_kg") => xs.reduce((a, o) => a + o[k], 0);
  const chilled = orders.filter((o) => o.temp_requirement === "chilled");
  const vanOnly = orders.filter((o) => o.parking_constraint === "van_only");
  const ambient = orders.filter((o) => o.temp_requirement === "ambient");
  const repeat = orders.filter((o) => o.deferred_yesterday || o.days_since_last_served >= 3);
  const reeferVol = reefers.reduce((a, v) => a + v.volume_cap_m3, 0);
  const reeferKg = reefers.reduce((a, v) => a + v.weight_cap_kg, 0);
  const chilledOver = sum(chilled, "order_volume_m3") > reeferVol * 2 || sum(chilled, "order_weight_kg") > reeferKg * 2;

  const q = query.trim().toLowerCase();
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = orders
    .filter((o) => f.test(o) && (brand === "all" || o.brand === brand) && (!q || `${o.outlet_id} ${o.district} ${o.order_ref}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = a[sort.key],
        y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir || a.outlet_id.localeCompare(b.outlet_id);
    });

  const figures = [
    { k: "Orders", v: orders.length, sub: `${new Set(orders.map((o) => o.outlet_id)).size} outlets` },
    { k: "Chilled", v: `${sum(chilled, "order_volume_m3").toFixed(0)} m³`, sub: `${chilled.length} orders`, bad: chilledOver },
    { k: "Refrigerated vehicles", v: reefers.length, sub: `${fleet.filter((v) => v.status !== "available" && v.temp === "reefer").length} in workshop`, bad: chilledOver },
    { k: "Van-only orders", v: vanOnly.length, sub: `${vans.length} vans available` },
    { k: "Skipped recently", v: repeat.length, sub: "ranked first in the plan", bad: repeat.length > 0 },
    { k: "Vehicles available", v: `${avail.length}/${fleet.length}`, sub: `${fleet.length - avail.length} in workshop` },
  ];

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Orders for {dateLabel("en", s.day.service_date, "weekday")}&apos;s run</h1>
          <p className="text-sm text-mute">Closed at 16:00. Every confirmed order is in one queue, so nothing is re-typed.</p>
        </div>
        <DepotToggle depot={depot} onChange={setDepot} />
        <BtnLink href="/dispatch/plan" variant="primary">
          Open plan board
        </BtnLink>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {figures.map((x) => (
          <div key={x.k} className="bg-card px-3 py-2">
            <dt className="text-xs text-mute">{x.k}</dt>
            <dd className={`font-cond text-2xl font-bold leading-tight ${x.bad ? "text-late" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-mute">{x.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Find an outlet or district</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find outlet or district" className="h-9 w-52 rounded-md border border-line bg-card pl-8 pr-2 text-sm" />
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-mute" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
              </svg>
            </label>
            <div role="radiogroup" aria-label="Filter" className="flex flex-wrap gap-1">
              {FILTERS.map((x) => (
                <button key={x.id} role="radio" aria-checked={filter === x.id} onClick={() => setFilter(x.id)} className={`h-9 rounded-md border px-3 text-sm font-medium ${filter === x.id ? "border-night bg-night text-white" : "border-line bg-card hover:border-night"}`}>
                  {x.label} <span className={filter === x.id ? "text-white/70" : "text-mute"}>{orders.filter(x.test).length}</span>
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-mute">Brand</span>
              <select value={brand} onChange={(e) => setBrand(e.target.value as typeof brand)} className="h-9 rounded-md border border-line bg-card px-2">
                <option value="all">All brands</option>
                <option>Fresh</option>
                <option>Style</option>
                <option>Tech</option>
              </select>
            </label>
          </div>

          <Card className="mt-3 overflow-hidden">
            <div className="max-h-[calc(100vh-19rem)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-paper text-left text-xs text-mute shadow-[0_1px_0_var(--color-line)]">
                  <tr>
                    {COLS.map((c) => {
                      const active = sort.key === c.key;
                      return (
                        <th key={c.key} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`px-3 py-2 font-medium ${c.num ? "text-right" : ""}`}>
                          <button onClick={() => setSort({ key: c.key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })} className={`inline-flex items-center gap-1 hover:text-night ${active ? "text-night" : ""}`}>
                            {c.label}
                            <span aria-hidden className="w-2 text-[10px]">
                              {active ? (sort.dir === 1 ? "▲" : "▼") : ""}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.order_ref} className={`border-t border-line/70 hover:bg-paper/70 ${o.deferred_yesterday ? "bg-late-soft/40" : ""}`}>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-cond font-semibold">{o.outlet_id}</span>
                          <OrderMarks o={o} />
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {o.brand} <span className="text-mute">{o.temp_requirement === "chilled" ? "chilled" : o.brand === "Fresh" ? "dry" : ""}</span>
                      </td>
                      <td className="px-3 py-1.5">{o.district}</td>
                      <td className="px-3 py-1.5 text-right font-cond">{o.order_units}</td>
                      <td className="px-3 py-1.5 text-right font-cond">{o.order_volume_m3.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right font-cond">{Math.round(o.order_weight_kg).toLocaleString()}</td>
                      <td className="px-3 py-1.5 font-cond">
                        {o.window_open_time}–{o.window_close_time}
                      </td>
                      <td className="px-3 py-1.5">
                        {o.deferred_yesterday ? <Chip tone="late">Skipped yesterday</Chip> : o.days_since_last_served >= 3 ? <Chip tone="hivis">{o.days_since_last_served} days ago</Chip> : <span className="text-xs text-mute">{o.days_since_last_served === 1 ? "Yesterday" : `${o.days_since_last_served} days ago`}</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length} className="px-3 py-6 text-center text-mute">
                        No orders match. Clear the search or pick another filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line bg-paper px-3 py-1.5 text-xs text-mute">
              Showing {rows.length} of {orders.length} · {sum(rows, "order_volume_m3").toFixed(1)} m³ · {(sum(rows, "order_weight_kg") / 1000).toFixed(1)} t
            </p>
          </Card>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-28 xl:self-start">
          <Card className={`p-4 ${chilledOver ? "border-late/50" : ""}`}>
            <p className={`font-semibold ${chilledOver ? "text-late" : "text-ok"}`}>{chilledOver ? "Deferral night: chilled demand exceeds refrigerated capacity" : "Demand fits tonight's capacity"}</p>
            <div className="mt-3 space-y-3">
              <Meter label={`Chilled volume · ${reefers.length} refrigerated × 2 trips`} used={sum(chilled, "order_volume_m3")} cap={reeferVol * 2} unit="m³" />
              <Meter label="Chilled weight · refrigerated × 2 trips" used={sum(chilled, "order_weight_kg") / 1000} cap={(reeferKg * 2) / 1000} unit="t" />
              <Meter label={`Van-only · ${vans.length} vans × 2 trips`} used={sum(vanOnly, "order_volume_m3")} cap={vans.reduce((a, v) => a + v.volume_cap_m3, 0) * 2} unit="m³" />
              <Meter label="Ambient · all vehicles × 2 trips" used={sum(ambient, "order_volume_m3")} cap={avail.reduce((a, v) => a + v.volume_cap_m3, 0) * 2} unit="m³" />
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold">Largest orders tonight</p>
            <ul className="mt-2 space-y-1 text-sm">
              {[...orders]
                .sort((a, b) => b.order_volume_m3 - a.order_volume_m3)
                .slice(0, 4)
                .map((o) => (
                  <li key={o.order_ref} className="flex justify-between gap-2">
                    <span>
                      <span className="font-cond font-semibold">{o.outlet_id}</span>{" "}
                      <span className="text-mute">
                        {o.brand} · {o.district}
                      </span>
                    </span>
                    <span className="font-cond">{o.order_volume_m3.toFixed(1)} m³</span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-xs text-mute">The largest available truck carries {Math.max(...avail.map((v) => v.volume_cap_m3))} m³. An order bigger than that can&apos;t be served whole.</p>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

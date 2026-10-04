"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LMap, Marker, Polyline } from "leaflet";
import { DepotToggle } from "@/components/DepotToggle";
import { Shell } from "@/components/Shell";
import { Btn, BtnLink, Card, Chip, IconChill, IconNoSignal } from "@/components/ui";
import { DEPOT_POS, DISTRICT_POS as DISTRICT_CENTER, outletPos, type LatLng } from "@/lib/geo";
import { compatibleSwap } from "@/lib/monitor";
import { DelayDecision, RoadBanner } from "@/components/DelayDecision";
import { delayedEta } from "@/lib/delay";
import { runFor, runKey } from "@/lib/runs";
import { seed, tripKey, vehicleById } from "@/lib/seed";
import { useDemo, type DemoState } from "@/lib/store";
import type { Order } from "@/lib/types";

type Status = "held" | "issue" | "nosignal" | "late" | "risk" | "ok" | "depot" | "done";
const LABEL: Record<Status, string> = { held: "Held up", issue: "Issue", nosignal: "No signal", late: "Likely late", risk: "At risk", ok: "On schedule", depot: "At the depot", done: "Completed" };
const COLOR: Record<Status, string> = { held: "#8a6400", issue: "#a8301f", nosignal: "#5d6b7e", late: "#a8301f", risk: "#f5b800", ok: "#23703c", depot: "#16233a", done: "#23703c" };
const RANK: Record<Status, number> = { held: -1, issue: 0, nosignal: 1, late: 2, risk: 3, ok: 4, depot: 5, done: 6 };

interface Run {
  k: string;
  vehicle_id: string;
  trip_id: number;
  depot: string;
  district: string;
  brand: string;
  depart: string;
  orders: Order[];
  status: Status;
  pos: LatLng;
  lastSeen: string;
  done: number;
  next?: Order;
  route: LatLng[];
  left?: string;
  lastAt: string;
}

/** Let marker labels size to their text instead of Leaflet's 12 px default box. */
const NO_SIZE = null as unknown as [number, number];
const NO_RUNS: Run[] = [];

const isDone = (s: DemoState, o: Order) => ["delivered", "received"].includes(s.states[o.order_ref].stage);

/** Where each run is, from the last thing the system actually heard: never an invented live position. */
function buildRuns(s: DemoState): Run[] {
  // One pass to group served orders by trip, instead of scanning every order for every trip.
  const byTrip = new Map<string, Order[]>();
  for (const o of s.orders) {
    if (o.decision !== "served") continue;
    const k = tripKey(o);
    const list = byTrip.get(k);
    if (list) list.push(o);
    else byTrip.set(k, [o]);
  }
  return seed.trips.map((t) => {
    const k = tripKey(t);
    const orders = (byTrip.get(k) ?? []).sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0));
    const mine = orders.filter((o) => !s.states[o.order_ref].reassignedTo);
    const left = s.departed[k];
    const delivered = mine.filter((o) => isDone(s, o));
    const next = mine.find((o) => !isDone(s, o));
    const phone = runFor(s, k);
    const offline = !!phone && !phone.online && !!left;
    const remainingRisk = Math.max(0, ...mine.filter((o) => !isDone(s, o)).map((o) => o.pred_late_prob ?? 0));
    const issue = orders.some((o) => {
      const st = s.states[o.order_ref];
      return (st.loadFlag && !st.loadDecision) || (st.receipt && !st.receipt.ok) || !!st.exception;
    });
    const depotPos = DEPOT_POS[t.depot];
    // The last thing the phone actually reported: leaving the depot, then each arrival or delivery.
    // Records still waiting in a phone's outbox are not reports yet.
    type Report = { at: string; pos: LatLng; text: string };
    const reports: Report[] = left ? [{ at: left, pos: depotPos, text: `left ${t.depot} depot` }] : [];
    for (const o of mine) {
      const st = s.states[o.order_ref];
      const pos = outletPos(o.outlet_id, o.district);
      if (st.arrivedAt) reports.push({ at: st.arrivedAt, pos, text: `arrived at ${o.outlet_id}` });
      if (st.deliveredAt && isDone(s, o)) reports.push({ at: st.deliveredAt, pos, text: `delivered at ${o.outlet_id}` });
    }
    const last = reports.sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    let pos: LatLng = depotPos;
    let lastSeen = s.published ? `At ${t.depot} depot, departs ${t.depart}` : "Plan not published";
    if (last) {
      pos = last.pos;
      lastSeen = `Last report ${last.at}: ${last.text}`;
      if (offline) lastSeen = `No signal since ${phone!.offlineSince}. ${lastSeen}`;
    }
    const delay = phone?.delay;
    const held = !!delay && !!next;
    if (held) lastSeen = `${delay!.via === "sms" ? "SMS" : "Report"} ${delay!.at}: held up near ${delay!.near}, about ${delay!.minutes} min. ${lastSeen}`;
    let status: Status = "depot";
    if (!next && left) status = "done";
    else if (held) status = "held";
    else if (issue) status = "issue";
    else if (offline) status = "nosignal";
    else if (remainingRisk >= 0.8) status = "late";
    else if (remainingRisk >= 0.5) status = "risk";
    else if (left) status = "ok";
    const route: LatLng[] = [depotPos, ...mine.map((o) => outletPos(o.outlet_id, o.district))];
    return { k, vehicle_id: t.vehicle_id, trip_id: t.trip_id, depot: t.depot, district: t.district, brand: t.brand, depart: t.depart, orders, status, pos, lastSeen, done: delivered.length, next, route, left, lastAt: last?.at ?? "" };
  });
}

type Leaflet = typeof import("leaflet");
type Drawn = { sig: string; line: Polyline; marker?: Marker };

const vehicleHtml = (r: Run, sel: boolean) => {
  const faded = r.status === "nosignal";
  return `<div style="display:flex;align-items:center;gap:4px;background:${faded ? "#ffffff" : COLOR[r.status]};color:${faded ? "#16233a" : r.status === "risk" ? "#16233a" : "#fff"};border:2px ${faded ? "dashed #5d6b7e" : "solid #ffffff"};border-radius:999px;padding:2px 8px;font:700 12px Barlow,sans-serif;box-shadow:0 1px 4px #0004;white-space:nowrap;${sel ? "outline:3px solid #16233a;" : ""}${faded ? "opacity:.9;" : ""}">${faded ? "⚠︎ " : ""}${r.vehicle_id}<span style="font-weight:500;opacity:.8">· ${r.lastAt}</span></div>`;
};
const depotHtml = (d: string, waiting: number) =>
  `<div style="background:#16233a;color:#fff;border:2px solid #f5b800;border-radius:6px;padding:2px 6px;font:600 12px Barlow,sans-serif;white-space:nowrap">${d} depot${waiting ? ` · ${waiting} at the dock` : ""}</div>`;

/**
 * The map is drawn once and then updated in place. Each run keeps its own line and marker, and is only
 * touched when something about it changed (status, last report, route, selection), so a live event from
 * any role costs a few Leaflet calls instead of a full redraw. The view is fitted when the depot changes or
 * the plan is first published, never while the dispatcher is panning or zooming.
 */
function LeafletMap({ runs, selected, onSelect, depot }: { runs: Run[]; selected?: string; onSelect: (k: string) => void; depot: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const L = useRef<Leaflet | null>(null);
  const layers = useRef<{ base: LayerGroup; outlets: LayerGroup; runs: LayerGroup } | null>(null);
  const drawn = useRef(new Map<string, Drawn>());
  const depotMarker = useRef<Marker | null>(null);
  const depotWaiting = useRef(-1);
  const outletKey = useRef("");
  const bounds = useRef<LatLng[]>([]);
  const userMoved = useRef(false);
  const programmatic = useRef(false);
  const fittedFor = useRef("");
  const select = useRef(onSelect);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  const fit = () => {
    const m = map.current;
    if (!m || !bounds.current.length) return;
    programmatic.current = true;
    m.fitBounds(bounds.current, { padding: [30, 30], maxZoom: 10, animate: false });
    programmatic.current = false;
    userMoved.current = false;
  };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    const runLayers = drawn.current;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      // Canvas draws hundreds of lines and circles far faster than one SVG element each.
      const m = mod.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([7.3, 80.4], 8);
      mod.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 13,
        keepBuffer: 4,
        updateWhenZooming: false,
        className: "rl-tiles",
      }).addTo(m);
      layers.current = { base: mod.layerGroup().addTo(m), outlets: mod.layerGroup().addTo(m), runs: mod.layerGroup().addTo(m) };
      m.on("movestart", () => {
        if (!programmatic.current) userMoved.current = true;
      });
      map.current = m;
      // Leaflet measures its box once; keep it in step with the layout, without undoing the user's view.
      ro = new ResizeObserver(() => {
        m.invalidateSize();
        if (!userMoved.current) fit();
      });
      ro.observe(el.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      runLayers.clear();
    };
  }, []);

  // Depot change: road disruptions and the depot marker, and start the runs afresh.
  useEffect(() => {
    const Lm = L.current;
    const ls = layers.current;
    if (!ready || !Lm || !ls) return;
    ls.base.clearLayers();
    ls.runs.clearLayers();
    ls.outlets.clearLayers();
    drawn.current.clear();
    outletKey.current = "";
    fittedFor.current = "";
    for (const [d, idx] of Object.entries(seed.road_today)) {
      const c = DISTRICT_CENTER[d];
      if (idx < 75 && c) Lm.circle(c, { radius: 9000, color: "#8a6400", weight: 1.5, dashArray: "4 4", fillColor: "#f5b800", fillOpacity: 0.12, interactive: true }).bindTooltip(`${d}: road index ${idx} today (100 is normal)`).addTo(ls.base);
    }
    depotWaiting.current = 0;
    depotMarker.current = Lm.marker(DEPOT_POS[depot], { icon: Lm.divIcon({ className: "", html: depotHtml(depot, 0), iconSize: NO_SIZE, iconAnchor: [50, 34] }), zIndexOffset: 400 }).addTo(ls.base);
  }, [ready, depot]);

  // Runs: update only what changed.
  useEffect(() => {
    const m = map.current;
    const Lm = L.current;
    const ls = layers.current;
    if (!ready || !m || !Lm || !ls) return;
    const shown = runs.filter((r) => r.depot === depot);

    // Outlets: one marker per outlet (not per order), redrawn only when the set or the selection changes.
    const outlets = new Map<string, { o: Order; chilled: boolean; sel: boolean }>();
    for (const r of shown)
      for (const o of r.orders) {
        const prev = outlets.get(o.outlet_id);
        outlets.set(o.outlet_id, { o, chilled: (prev?.chilled ?? false) || o.temp_requirement === "chilled", sel: (prev?.sel ?? false) || r.k === selected });
      }
    const ok = [...outlets].map(([id, x]) => `${id}${x.chilled ? "c" : ""}${x.sel ? "s" : ""}`).join(",");
    if (ok !== outletKey.current) {
      outletKey.current = ok;
      ls.outlets.clearLayers();
      for (const [id, { o, chilled, sel }] of outlets)
        Lm.circleMarker(outletPos(id, o.district), { radius: sel ? 6 : 4, color: "#ffffff", weight: 1.5, fillColor: chilled ? "#16639a" : "#5d6b7e", fillOpacity: 0.95 })
          .bindTooltip(`${id} · ${o.district} · window ${o.window_open_time}–${o.window_close_time}`)
          .addTo(ls.outlets);
    }

    const keep = new Set<string>();
    for (const r of shown) {
      keep.add(r.k);
      const sel = r.k === selected;
      const sig = [r.status, sel, r.left ?? "", r.lastAt, r.lastSeen, r.pos.join(), r.route.length].join("|");
      const d = drawn.current.get(r.k);
      if (d && d.sig === sig) continue;
      const style = { color: sel ? "#16233a" : COLOR[r.status], weight: sel ? 4 : 2, opacity: sel ? 0.9 : 0.35, dashArray: r.status === "depot" ? "4 6" : undefined };
      const line = d?.line ?? Lm.polyline(r.route, style).on("click", () => select.current(r.k)).addTo(ls.runs);
      if (d) line.setLatLngs(r.route).setStyle(style);
      if (sel) line.bringToFront();
      let marker = d?.marker;
      if (r.left) {
        const icon = Lm.divIcon({ className: "", html: vehicleHtml(r, sel), iconSize: NO_SIZE, iconAnchor: [30, -6] });
        if (marker) marker.setLatLng(r.pos).setIcon(icon).setZIndexOffset(sel ? 1000 : 500).setTooltipContent(r.lastSeen);
        else marker = Lm.marker(r.pos, { icon, zIndexOffset: sel ? 1000 : 500 }).bindTooltip(r.lastSeen, { direction: "top" }).on("click", () => select.current(r.k)).addTo(ls.runs);
      } else if (marker) {
        // Still at the depot: the depot marker stands for it.
        marker.remove();
        marker = undefined;
      }
      drawn.current.set(r.k, { sig, line, marker });
    }
    for (const [k, d] of drawn.current)
      if (!keep.has(k)) {
        d.line.remove();
        d.marker?.remove();
        drawn.current.delete(k);
      }

    const waiting = shown.filter((r) => !r.left).length;
    if (waiting !== depotWaiting.current) {
      depotWaiting.current = waiting;
      depotMarker.current?.setIcon(Lm.divIcon({ className: "", html: depotHtml(depot, waiting), iconSize: NO_SIZE, iconAnchor: [50, 34] }));
    }

    bounds.current = [DEPOT_POS[depot], ...shown.flatMap((r) => r.route)];
    // Fit once per depot (and again when the plan first appears), not on every live update.
    const fitKey = `${depot}|${shown.length > 0}`;
    if (fittedFor.current !== fitKey) {
      fittedFor.current = fitKey;
      m.invalidateSize();
      fit();
    }
  }, [ready, runs, selected, depot]);

  // Bring a run selected from the list into view, keeping the dispatcher's zoom.
  useEffect(() => {
    const m = map.current;
    const r = runs.find((x) => x.k === selected && x.depot === depot);
    if (!ready || !m || !r) return;
    if (!m.getBounds().contains(r.pos)) {
      programmatic.current = true;
      m.panTo(r.pos, { animate: true });
      programmatic.current = false;
    }
    // Only when the selection changes, not on every update of that run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected, depot]);

  return (
    <div className="relative">
      <div ref={el} className="h-[560px] w-full" aria-label="Map of runs, outlets and depots" role="region" />
      <button onClick={fit} className="absolute bottom-6 right-3 z-[500] rounded-md border border-line bg-card px-2.5 py-1.5 text-xs font-semibold shadow hover:border-night">
        Show all runs
      </button>
    </div>
  );
}

export default function MapPage() {
  const { s, dispatch } = useDemo();
  const [depot, setDepot] = useState("Kandy");
  const [filter, setFilter] = useState<"all" | "attention" | "road" | "depot">("all");
  const runs = useMemo(() => buildRuns(s), [s]);
  const [selected, setSelected] = useState<string | undefined>(() => runKey(s.driver));
  const here = runs.filter((r) => r.depot === depot).sort((a, b) => RANK[a.status] - RANK[b.status] || a.depart.localeCompare(b.depart));
  const match = (r: Run, f: typeof filter) => f === "all" || (f === "attention" ? ["issue", "nosignal", "late", "risk"].includes(r.status) : f === "road" ? !!r.left : !r.left);
  const shown = here.filter((r) => match(r, filter));
  const sel = runs.find((r) => r.k === selected && r.depot === depot);
  const count = (f: typeof filter) => here.filter((r) => match(r, f)).length;

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Check-in map</h1>
          <p className="text-sm text-mute">Each vehicle is shown where it last checked in, never a guessed live position. Faded means no signal: that is the last place we heard from it.</p>
        </div>
        <DepotToggle depot={depot} onChange={(d) => { setDepot(d); setSelected(undefined); }} />
      </div>
      <RoadBanner />

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="relative isolate self-start overflow-hidden">
          {!s.published && (
            <div className="absolute left-14 right-3 top-3 z-[500] rounded-md bg-amber-soft px-4 py-2 text-sm font-semibold text-hivis-deep shadow">Planned routes appear here after the plan is published.</div>
          )}
          <LeafletMap runs={s.published ? runs : NO_RUNS} selected={selected} onSelect={setSelected} depot={depot} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-mute">
            {(["ok", "risk", "late", "issue", "nosignal"] as Status[]).map((st) => (
              <span key={st} className="inline-flex items-center gap-1">
                <i className="size-2.5 rounded-full" style={{ background: st === "nosignal" ? "#fff" : COLOR[st], border: st === "nosignal" ? "1.5px dashed #5d6b7e" : undefined }} /> {LABEL[st]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-full bg-chill" /> Chilled outlet</span>
            <span className="ml-auto">Outlet positions are approximate (district level): the data has no outlet coordinates.</span>
          </div>
        </Card>

        <div className="space-y-3">
          {sel && s.published ? <RunDetail r={sel} onClose={() => setSelected(undefined)} dispatch={dispatch} s={s} /> : null}
          <Card>
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1 border-b border-line p-2">
              {([["all", "All"], ["attention", "Needs attention"], ["road", "Left the depot"], ["depot", "At the depot"]] as const).map(([f, l]) => (
                <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={`h-8 rounded-md border px-2 text-xs font-medium ${filter === f ? "border-night bg-night text-white" : "border-line bg-card hover:border-night"}`}>
                  {l} <span className={filter === f ? "text-white/70" : "text-mute"}>{count(f)}</span>
                </button>
              ))}
            </div>
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {!s.published && <li className="px-3 py-4 text-sm text-mute">Publish the plan to see runs.</li>}
              {s.published &&
                shown.map((r) => (
                  <li key={r.k}>
                    <button onClick={() => setSelected(r.k)} className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper ${r.k === selected ? "bg-amber-soft" : ""}`}>
                      <i className="size-3 shrink-0 rounded-full" style={{ background: r.status === "nosignal" ? "#fff" : COLOR[r.status], border: r.status === "nosignal" ? "1.5px dashed #5d6b7e" : undefined }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 font-cond text-base font-bold">
                          {r.vehicle_id} <span className="font-sans text-xs font-normal text-mute">trip {r.trip_id} · {r.district}</span>
                          {vehicleById.get(r.vehicle_id)?.temp === "reefer" && <span className="text-chill"><IconChill className="size-3.5" /></span>}
                        </span>
                        <span className="block truncate text-xs text-mute">{r.lastSeen}</span>
                      </span>
                      <span className="text-right text-xs">
                        <span className="block font-semibold">{LABEL[r.status]}</span>
                        <span className="text-mute">{r.done}/{r.orders.filter((o) => !s.states[o.order_ref].reassignedTo).length}</span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

function RunDetail({ r, onClose, s, dispatch }: { r: Run; onClose: () => void; s: DemoState; dispatch: ReturnType<typeof useDemo>["dispatch"] }) {
  const moved = r.orders.filter((o) => s.states[o.order_ref].reassignedTo);
  const mine = r.orders.filter((o) => !s.states[o.order_ref].reassignedTo);
  const last = [...mine].reverse().find((o) => !isDone(s, o));
  const swap = last ? compatibleSwap(last, r.vehicle_id) : undefined;
  const slack = r.next && r.next.pred_arrival ? minutes(r.next.window_close_time) - minutes(r.next.pred_arrival) : undefined;
  return (
    <Card className="border-2 border-night p-4">
      <div className="flex items-start gap-2">
        <div>
          <p className="font-cond text-2xl font-bold leading-tight">
            {r.vehicle_id} · trip {r.trip_id}
          </p>
          <p className="text-sm text-mute">
            {r.brand} · {r.district} · departs {r.depart}
            {runFor(s, r.k)?.name ? ` · ${runFor(s, r.k)!.name}` : ""}
          </p>
        </div>
        <button onClick={onClose} className="ml-auto grid size-8 place-items-center rounded-md text-mute hover:bg-paper" aria-label="Close">
          ✕
        </button>
      </div>
      <p className={`mt-2 rounded-md px-3 py-2 text-sm ${r.status === "nosignal" ? "bg-amber-soft font-semibold" : "bg-paper"}`}>
        {r.status === "nosignal" && <IconNoSignal className="mr-1 inline size-4" />}
        {r.lastSeen}
      </p>
      {r.next && (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-paper px-3 py-1.5">
            <dt className="text-xs text-mute">Next stop</dt>
            <dd className="font-cond text-lg font-bold">{r.next.outlet_id}</dd>
          </div>
          <div className="rounded-md bg-paper px-3 py-1.5">
            <dt className="text-xs text-mute">ETA vs window</dt>
            <dd className={`font-cond text-lg font-bold ${slack !== undefined && slack < 0 ? "text-late" : slack !== undefined && slack < 15 ? "text-hivis-deep" : ""}`}>
              {r.next.pred_arrival} / {r.next.window_close_time}
            </dd>
          </div>
        </dl>
      )}
      <ol className="mt-3 space-y-1 text-sm">
        {r.orders.map((o) => {
          const st = s.states[o.order_ref];
          const late = (o.pred_late_prob ?? 0) >= 0.5 && !isDone(s, o) && !st.reassignedTo;
          return (
            <li key={o.order_ref} className={`flex items-center gap-2 ${st.reassignedTo ? "text-mute line-through" : ""}`}>
              <span className="w-5 font-cond font-bold">{o.stop_seq}</span>
              <span className="font-cond font-semibold">{o.outlet_id}</span>
              {o.temp_requirement === "chilled" && <span className="text-chill"><IconChill className="size-3.5" /></span>}
              <span className="text-mute">{o.window_open_time}–{o.window_close_time}</span>
              <span className="ml-auto">
                {isDone(s, o) ? <Chip tone="ok">Delivered {st.deliveredAt}</Chip> : st.reassignedTo ? <Chip>Moved to {st.reassignedTo}</Chip> : st.deferredEnRoute ? <Chip tone="late">Back to depot</Chip> : delayedEta(s, o) ? <Chip tone={delayedEta(s, o)!.late ? "late" : "neutral"}>ETA {delayedEta(s, o)!.from} (delayed)</Chip> : late ? <Chip tone="late">ETA {o.pred_arrival}</Chip> : <span className="text-mute">ETA {o.pred_arrival}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {runFor(s, r.k)?.delay && (
        <div className="mt-3">
          <DelayDecision vid={r.vehicle_id} />
        </div>
      )}
      {moved.length > 0 && (
        <div className="mt-3 rounded-md border border-line p-3 text-sm">
          <p className="font-semibold">Route change</p>
          <p className="mt-1 text-mute">Before: {r.orders.map((o) => o.outlet_id).join(" → ")}</p>
          <p className="text-mute">After: {mine.map((o) => o.outlet_id).join(" → ")}</p>
          {moved.map((o) => (
            <p key={o.order_ref} className="mt-1">
              {o.outlet_id} → {s.states[o.order_ref].reassignedTo}. Reason: predicted {o.pred_arrival}, after its window closes at {o.window_close_time}.
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "nosignal" && !runFor(s, r.k)?.delay && last && swap && (last.pred_late_prob ?? 0) >= 0.5 && (
          <Btn variant="primary" onClick={() => dispatch({ type: "reassign", ref: last.order_ref, to: swap })}>
            Move last stop ({last.outlet_id}) to {swap}
          </Btn>
        )}
        <BtnLink href="/dispatch/monitor">Open in live runs</BtnLink>
        <Link href={`/dock/${r.vehicle_id}/${r.trip_id}`} className="inline-flex h-9 items-center px-2 text-sm font-semibold text-mute underline">
          Loading list
        </Link>
      </div>
    </Card>
  );
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LMap } from "leaflet";
import { DEPOT_POS, outletPos, type LatLng } from "@/lib/geo";

export interface RouteTrip {
  trip_id: number;
  stops: { outlet_id: string; district: string; seq: number }[];
}

/** Trip 1 navy and solid, trip 2 amber and dashed: told apart in colour and in line style. */
export const TRIP_STYLE: Record<number, { color: string; dash?: string }> = {
  1: { color: "#16233a" },
  2: { color: "#c98a00", dash: "8 6" },
};

const stopHtml = (n: number, color: string) =>
  `<div style="display:grid;place-items:center;width:24px;height:24px;border-radius:999px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 3px #0005;font:700 12px Barlow,sans-serif">${n}</div>`;
const depotHtml = (d: string) =>
  `<div style="background:#16233a;color:#fff;border:2px solid #f5b800;border-radius:6px;padding:2px 6px;font:600 12px Barlow,sans-serif;white-space:nowrap">${d} depot</div>`;

/**
 * A vehicle's planned route: from its depot through each trip's stops in order and back. Store positions are
 * approximate (the data has no addresses, see lib/geo.ts) and the lines are straight, not roads.
 */
export function RouteMap({ depot, trips }: { depot: string; trips: RouteTrip[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  const bounds = useRef<LatLng[]>([]);
  // Fit the whole route; again whenever the panel's size settles (Leaflet measures its box once).
  const fit = () => {
    if (map.current && bounds.current.length) map.current.fitBounds(bounds.current, { padding: [28, 28], maxZoom: 11, animate: false });
  };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      const m = mod.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([7.3, 80.4], 8);
      mod.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 14,
        className: "rl-tiles",
      }).addTo(m);
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      ro = new ResizeObserver(() => {
        m.invalidateSize();
        fit();
      });
      ro.observe(el.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Draw the route again whenever the trips change (a drag on the board, or another vehicle chosen).
  const sig = JSON.stringify([depot, trips]);
  useEffect(() => {
    const Lm = L.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !Lm || !m || !g) return;
    g.clearLayers();
    const home = DEPOT_POS[depot] ?? [7.3, 80.4];
    const all: LatLng[] = [home];
    for (const t of trips) {
      const style = TRIP_STYLE[t.trip_id] ?? TRIP_STYLE[1];
      const pts = t.stops.map((s) => outletPos(s.outlet_id, s.district));
      const path: LatLng[] = [home, ...pts, home];
      all.push(...pts);
      Lm.polyline(path, { color: style.color, weight: 4, opacity: 0.85, dashArray: style.dash }).addTo(g);
      t.stops.forEach((s, i) =>
        Lm.marker(pts[i], { icon: Lm.divIcon({ html: stopHtml(i + 1, style.color), className: "", iconSize: [24, 24], iconAnchor: [12, 12] }), keyboard: false })
          .bindTooltip(`Trip ${t.trip_id}, stop ${i + 1}: ${s.outlet_id}`, { direction: "top", offset: [0, -10] })
          .addTo(g),
      );
    }
    Lm.marker(home, { icon: Lm.divIcon({ html: depotHtml(depot), className: "", iconSize: undefined, iconAnchor: [10, 10] }), keyboard: false, zIndexOffset: 1000 }).addTo(g);
    bounds.current = all;
    m.invalidateSize();
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig]);

  return <div ref={el} className="h-64 w-full overflow-hidden rounded-md border border-line" role="img" aria-label={`Route map from ${depot} depot`} />;
}

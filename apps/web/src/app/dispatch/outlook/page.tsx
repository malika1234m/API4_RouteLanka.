"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { seed } from "@/lib/seed";
import type { OutlookWeek } from "@/lib/types";

// Chilled orders are the only thing refrigerated capacity limits, so the chart shows chilled volume only.
const OK = "#16639a"; // chill: within what the trucks can carry
const OVER = "#a8301f"; // late (status): more than the trucks can carry, always with ▲ and a label
const TIGHT = "#c98a00"; // warning (status): at the limit, always with ● in the legend and the summary
const INK = "#16233a";
const MUTE = "#5d6b7e";

/** "thai_pongal" → "Thai Pongal" */
const festName = (f: string) => f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** The Monday of ISO week w of year y, e.g. "15 Dec". */
const weekStart = (y: number, w: number) => {
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (w - 1) * 7 * 864e5);
  return mon.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** Over capacity: more than 5% above what the trucks have carried on their busiest days. */
const isOver = (w: OutlookWeek) => w.chilled > w.chilled_capacity * 1.05;
/** At the limit: within 3% below what the trucks carry, or up to 5% over it. Expect a few deferrals. */
const isTight = (w: OutlookWeek) => !isOver(w) && w.chilled > w.chilled_capacity * 0.97;

const reeferSize = (depot: string) => {
  const r = seed.vehicles.filter((v) => v.depot === depot && v.temp === "reefer" && v.type === "truck");
  return r.reduce((a, v) => a + v.volume_cap_m3, 0) / Math.max(r.length, 1);
};
const extraTrips = (w: OutlookWeek) => (isOver(w) ? Math.ceil((w.chilled - w.chilled_capacity) / reeferSize(w.depot)) : 0);

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export default function Outlook() {
  const [depot, setDepot] = useState<"both" | "Peliyagoda" | "Kandy">("both");
  const all = seed.outlook;
  const over = all.filter(isOver).sort((a, b) => a.iso_year - b.iso_year || a.iso_week - b.iso_week || a.depot.localeCompare(b.depot));
  const trips = over.reduce((n, w) => n + extraTrips(w), 0);
  const busiest = [...all].sort((a, b) => b.chilled - a.chilled)[0];
  const depots = depot === "both" ? ["Peliyagoda", "Kandy"] : [depot];
  const anyForecast = all.some((w) => !w.actual);
  const anyActual = all.some((w) => w.actual);
  // Forecast weeks are drawn lighter only when the chart mixes them with actual weeks.
  const mixed = anyForecast && anyActual;

  const tiles = [
    { k: "Weeks needing extra trucks", v: over.length, sub: over.length ? "chilled orders more than the trucks can carry" : "the trucks are enough every week", bad: over.length > 0 },
    { k: "Extra refrigerated trips", v: trips, sub: "to plan over the 10 weeks", bad: trips > 0 },
    {
      k: "Busiest chilled week",
      v: busiest ? `Week of ${weekStart(busiest.iso_year, busiest.iso_week)}` : "—",
      sub: busiest ? `${busiest.depot} · ${busiest.chilled.toLocaleString()} m³${busiest.festival ? ` · ${festName(busiest.festival)}` : ""}` : "",
    },
  ];

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-cond text-2xl font-bold leading-tight">Capacity outlook · next 10 weeks</h1>
        <div role="radiogroup" aria-label="Depot" className="inline-flex rounded-md border border-line bg-card p-0.5 text-sm">
          {(["both", "Peliyagoda", "Kandy"] as const).map((d) => (
            <button key={d} role="radio" aria-checked={depot === d} onClick={() => setDepot(d)} className={`rounded px-3 py-1 font-medium ${depot === d ? "bg-night text-white" : "text-mute hover:text-night"}`}>
              {d === "both" ? "Both depots" : d}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-3 grid rl-stats sm:grid-cols-3">
        {tiles.map((x) => (
          <div key={x.k} className="bg-card px-4 py-3">
            <dt className="text-xs text-mute">{x.k}</dt>
            <dd className={`font-cond text-3xl font-bold leading-tight ${x.bad ? "text-late" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-mute">{x.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Swatch color={OK} label={mixed ? "Chilled orders" : anyActual ? "Chilled orders (actual)" : "Chilled orders (forecast)"} />
            {mixed && <Swatch color={OK} faded label="Forecast weeks" />}
            <Swatch color={TIGHT} label="● At the limit" />
            <Swatch color={OVER} label="▲ More than the trucks can carry" />
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-5" style={{ background: INK }} /> What our refrigerated trucks can carry
            </span>
          </div>
          <div className={`mt-3 grid gap-4 ${depots.length > 1 ? "2xl:grid-cols-2" : ""}`}>
            {depots.map((d) => (
              <DepotChart key={d} depot={d} weeks={all.filter((w) => w.depot === d)} mixed={mixed} />
            ))}
          </div>
        </div>

        <aside className="xl:sticky xl:top-28 xl:self-start">
          <Card>
            <p className="border-b border-line px-4 py-2.5 font-cond text-lg font-semibold">What to plan</p>
            <ul className="divide-y divide-line text-sm">
              {over.length === 0 && <li className="px-4 py-3 text-mute">Nothing: the refrigerated trucks are enough for every week.</li>}
              {over.map((w) => (
                <li key={`${w.depot}${w.iso_year}${w.iso_week}`} className="px-4 py-2.5">
                  <span className="block font-semibold">
                    Add {extraTrips(w)} refrigerated trip{extraTrips(w) > 1 ? "s" : ""} at {w.depot}
                  </span>
                  <span className="block text-xs text-mute">
                    Week of {weekStart(w.iso_year, w.iso_week)}
                    {w.festival ? ` · ${festName(w.festival)}` : ""} · {Math.round(w.chilled - w.chilled_capacity)} m³ over
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

function Swatch({ color, label, faded = false }: { color: string; label: string; faded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3 rounded-sm" style={{ background: color, opacity: faded ? 0.45 : 1 }} />
      {label}
    </span>
  );
}

/** One plain sentence on what the weeks mean for this depot. */
function summary(weeks: OutlookWeek[]) {
  const over = weeks.filter(isOver);
  const tight = weeks.filter(isTight);
  if (over.length) {
    const n = over.reduce((a, w) => a + extraTrips(w), 0);
    const when = list(over.map((w) => weekStart(w.iso_year, w.iso_week)));
    const limit = tight.length ? ` At the limit in ${tight.length} more.` : "";
    return { bad: true, text: `${over.length} week${over.length > 1 ? "s need" : " needs"} extra refrigerated trucks: week${over.length > 1 ? "s" : ""} of ${when} (${n} extra trip${n > 1 ? "s" : ""}).${limit}` };
  }
  if (tight.length)
    return { bad: false, text: `At the limit in ${tight.length} week${tight.length > 1 ? "s" : ""} (${list(tight.map((w) => weekStart(w.iso_year, w.iso_week)))}): expect a few deferrals.` };
  return { bad: false, text: "The refrigerated trucks are enough for all 10 weeks." };
}

function DepotChart({ depot, weeks, mixed }: { depot: string; weeks: OutlookWeek[]; mixed: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 620, H = 250, L = 44, R = 12, T = 24, B = 46;
  const max = Math.max(...weeks.map((w) => Math.max(w.chilled, w.chilled_capacity))) * 1.15;
  const step = niceStep(max);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const band = (W - L - R) / weeks.length;
  const bw = Math.min(28, band * 0.55);
  const sum = summary(weeks);
  const h = hover !== null ? weeks[hover] : null;

  return (
    <Card className="p-4">
      <p className="font-cond text-xl font-semibold">{depot}</p>
      <p className={`text-sm ${sum.bad ? "font-semibold text-late" : "text-mute"}`}>{sum.text}</p>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${depot}: chilled orders each week against what the refrigerated trucks can carry. ${sum.text}`}>
          <defs>
            {([["ok", OK], ["over", OVER], ["tight", TIGHT]] as const).map(([id, c]) => (
              <linearGradient key={id} id={`bar-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c} stopOpacity={0.95} />
                <stop offset="1" stopColor={c} stopOpacity={0.7} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#E4E8EE" strokeWidth={1} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTE}>
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          <text x={L - 6} y={T - 10} textAnchor="end" fontSize={11} fill={MUTE}>
            m³
          </text>
          {weeks.map((w, i) => {
            const cx = L + band * i + band / 2;
            const over = isOver(w);
            const top = y(w.chilled);
            const base = y(0);
            return (
              <g
                key={`${w.iso_year}-${w.iso_week}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`Week of ${weekStart(w.iso_year, w.iso_week)}: ${w.chilled} m³ chilled, trucks carry ${w.chilled_capacity} m³${over ? `, ${Math.round(w.chilled - w.chilled_capacity)} m³ over` : ""}`}
              >
                <rect x={L + band * i} y={T} width={band} height={H - T - B} fill={hover === i ? "#F2F4F7" : "transparent"} />
                <path d={roundTop(cx - bw / 2, top, bw, base - top, 4)} fill={`url(#bar-${over ? "over" : isTight(w) ? "tight" : "ok"})`} opacity={mixed && !w.actual ? 0.45 : 1} style={{ filter: hover === i ? "drop-shadow(0 4px 8px rgb(22 35 58 / 0.25))" : undefined, transition: "filter 150ms" }} />
                {/* What the trucks can carry that week (it follows the operating days). */}
                <line x1={L + band * i + 2} x2={L + band * (i + 1) - 2} y1={y(w.chilled_capacity)} y2={y(w.chilled_capacity)} stroke={INK} strokeWidth={2} />
                {over && (
                  <text x={cx} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
                    <tspan fill={OVER}>▲</tspan> +{Math.round(w.chilled - w.chilled_capacity)}
                  </text>
                )}
                <text x={cx} y={H - B + 16} textAnchor="middle" fontSize={11} fill={INK}>
                  {weekStart(w.iso_year, w.iso_week)}
                </text>
                {w.festival && (
                  <text x={cx} y={H - B + 30} textAnchor="middle" fontSize={10} fill={MUTE}>
                    {festName(w.festival)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-card px-3 py-2 text-xs shadow-sm" style={{ left: `${Math.min(((L + band * hover + band) / W) * 100, 62)}%` }}>
            <p className="font-semibold">
              Week of {weekStart(h.iso_year, h.iso_week)} · {h.actual ? "actual orders" : "forecast"}
            </p>
            <p>Chilled orders: {h.chilled.toLocaleString()} m³</p>
            <p>Trucks can carry: {h.chilled_capacity.toLocaleString()} m³</p>
            <p className={isOver(h) ? "font-semibold text-late" : isTight(h) ? "font-semibold text-hivis-deep" : "text-ok"}>
              {isOver(h)
                ? `${Math.round(h.chilled - h.chilled_capacity)} m³ over: ${extraTrips(h)} extra trip${extraTrips(h) > 1 ? "s" : ""}`
                : isTight(h)
                  ? "At the limit: expect a few deferrals"
                  : `${Math.round(h.chilled_capacity - h.chilled)} m³ to spare`}
            </p>
            {(h.festival || h.paydays > 0) && <p className="text-mute">{[h.festival && festName(h.festival), h.paydays > 0 && `${h.paydays} payday`].filter(Boolean).join(" · ")}</p>}
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-mute">Show as table</summary>
        <table className="mt-2 w-full text-right font-cond">
          <thead className="text-xs text-mute">
            <tr>
              <th className="text-left font-medium">Week of</th>
              <th className="font-medium">Chilled m³</th>
              <th className="font-medium">Trucks carry m³</th>
              <th className="font-medium">Extra trips</th>
              <th className="pl-3 text-left font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={`${w.iso_year}-${w.iso_week}`} className="border-t border-line/60">
                <td className="text-left">{weekStart(w.iso_year, w.iso_week)}</td>
                <td className={isOver(w) ? "font-bold text-late" : ""}>{w.chilled.toLocaleString()}</td>
                <td>{w.chilled_capacity.toLocaleString()}</td>
                <td>{extraTrips(w) || "—"}</td>
                <td className="pl-3 text-left">{[w.actual ? "actual" : "forecast", w.festival && festName(w.festival)].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
}

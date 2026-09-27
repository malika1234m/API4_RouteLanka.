"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Card, Chip } from "@/components/ui";
import { seed } from "@/lib/seed";
import type { OutlookWeek } from "@/lib/types";

const CHILL = "#1F78B4";
const AMBIENT = "#B7832F"; // validated pair: ΔE 21.5 worst-case CVD, both ≥3:1 on white

const weekStart = (w: number) => {
  // ISO week w of 2026 → Monday date
  const jan4 = new Date(Date.UTC(2026, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (w - 1) * 7 * 864e5);
  return mon.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

export default function Outlook() {
  const [depot, setDepot] = useState<"both" | "Peliyagoda" | "Kandy">("both");
  const avgReefer = (d: string) => {
    const r = seed.vehicles.filter((v) => v.depot === d && v.temp === "reefer" && v.type === "truck");
    return r.reduce((a, v) => a + v.volume_cap_m3, 0) / Math.max(r.length, 1);
  };
  const actions = seed.outlook
    .filter((w) => w.chilled > w.chilled_capacity * 1.05)
    .map((w) => {
      const over = w.chilled - w.chilled_capacity;
      return { ...w, over, trips: Math.ceil(over / avgReefer(w.depot)) };
    })
    .sort((a, b) => a.iso_week - b.iso_week || a.depot.localeCompare(b.depot));
  const all = seed.outlook;
  const peak = [...all].sort((a, b) => b.total - a.total)[0];
  const peakChill = [...all].sort((a, b) => b.chilled - a.chilled)[0];
  const extraTrips = actions.reduce((a, x) => a + x.trips, 0);
  const figures = [
    { k: "Busiest week", v: `W${peak.iso_week}`, sub: `${peak.depot} · ${peak.total.toLocaleString()} m³` },
    { k: "Chilled peak", v: `${peakChill.chilled.toLocaleString()} m³`, sub: `W${peakChill.iso_week} · ${peakChill.depot}` },
    { k: "Weeks over capacity", v: new Set(actions.map((a) => `${a.depot}${a.iso_week}`)).size, sub: "chilled more than 5% over", bad: actions.length > 0 },
    { k: "Extra refrigerated trips", v: extraTrips, sub: "over the 10 weeks", bad: extraTrips > 0 },
    { k: "Festivals ahead", v: new Set(all.filter((w) => w.festival).map((w) => w.festival)).size, sub: [...new Set(all.filter((w) => w.festival).map((w) => w.festival[0].toUpperCase() + w.festival.slice(1)))].join(", ") || "none" },
    { k: "Paydays ahead", v: all.filter((w) => w.depot === "Peliyagoda").reduce((a, w) => a + w.paydays, 0), sub: "demand rises around each" },
  ];
  const depots = depot === "both" ? ["Peliyagoda", "Kandy"] : [depot];

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Capacity outlook · next 10 weeks</h1>
          <p className="max-w-3xl text-sm text-mute">Forecast volume per depot against the chilled volume the refrigerated fleet has actually moved on its busiest days.</p>
        </div>
        <div role="radiogroup" aria-label="Depot" className="inline-flex rounded-md border border-line bg-card p-0.5 text-sm">
          {(["both", "Peliyagoda", "Kandy"] as const).map((d) => (
            <button key={d} role="radio" aria-checked={depot === d} onClick={() => setDepot(d)} className={`rounded px-3 py-1 font-medium ${depot === d ? "bg-night text-white" : "text-mute hover:text-night"}`}>
              {d === "both" ? "Both depots" : d}
            </button>
          ))}
        </div>
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
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Key color={CHILL} label="Chilled" />
            <Key color={AMBIENT} label="Ambient" />
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-5 bg-night" /> Refrigerated capacity (demonstrated)
            </span>
            <span className="text-mute">Hover or tab to a week for details.</span>
          </div>
          <div className={`mt-3 grid gap-4 ${depots.length > 1 ? "xl:grid-cols-2" : ""}`}>
            {depots.map((d) => (
              <DepotChart key={d} depot={d} weeks={seed.outlook.filter((w) => w.depot === d)} />
            ))}
          </div>
          <p className="mt-3 text-xs text-mute">Prototype forecast: same week last year × this year&apos;s growth, adjusted for operating days. The Datathon demand model replaces it in the build.</p>
        </div>
        <aside className="space-y-3 xl:sticky xl:top-28 xl:self-start">
          <Card>
            <p className="border-b border-line px-4 py-2.5 font-cond text-lg font-semibold">Actions to plan</p>
            <ul className="divide-y divide-line text-sm">
              {actions.length === 0 && <li className="px-4 py-3 text-mute">No week needs extra refrigerated capacity.</li>}
              {actions.map((a) => (
                <li key={`${a.depot}${a.iso_week}`} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-late-soft font-cond font-bold text-late">W{a.iso_week}</span>
                  <span>
                    <span className="block font-semibold">
                      Add {a.trips} refrigerated trip{a.trips > 1 ? "s" : ""} at {a.depot}
                    </span>
                    <span className="block text-xs text-mute">
                      Chilled {a.chilled.toLocaleString()} m³ vs {a.chilled_capacity.toLocaleString()} capacity ({Math.round(a.over)} m³ over){a.festival ? ` · ${a.festival} week` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4 text-sm">
            <p className="font-semibold">How to read this</p>
            <p className="mt-1 text-mute">
              Capacity is what the refrigerated fleet has actually moved on its busiest past days, not its theoretical maximum. Demand near the line means routine deferrals. Demand well above it means hiring refrigerated trucks or bringing
              vehicles out of the workshop early.
            </p>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function DepotChart({ depot, weeks }: { depot: string; weeks: OutlookWeek[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 620, H = 260, L = 48, R = 12, T = 16, B = 44;
  const max = Math.max(...weeks.map((w) => Math.max(w.total, w.chilled_capacity))) * 1.1;
  const step = niceStep(max);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const band = (W - L - R) / weeks.length;
  const bw = Math.min(24, band * 0.5);
  // Capacity is what the fleet has demonstrably moved, so demand near it is normal; flag clear overruns.
  const over = weeks.filter((w) => w.chilled > w.chilled_capacity * 1.05);
  const tight = weeks.filter((w) => w.chilled > w.chilled_capacity * 0.97 && !over.includes(w));
  const h = hover !== null ? weeks[hover] : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-cond text-xl font-semibold">{depot}</p>
        {over.length ? (
          <Chip tone="late">
            ▲ Chilled over capacity in week{over.length > 1 ? "s" : ""} {over.map((w) => w.iso_week).join(", ")}
          </Chip>
        ) : tight.length ? (
          <Chip tone="hivis">● Chilled at capacity in {tight.length} weeks: expect routine deferrals</Chip>
        ) : (
          <Chip tone="ok">✓ Chilled within capacity all 10 weeks</Chip>
        )}
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${depot} weekly forecast volume, chilled and ambient`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#E4E8EE" strokeWidth={1} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5d6b7e">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          <text x={L - 6} y={T - 4} textAnchor="end" fontSize={11} fill="#5d6b7e">
            m³
          </text>
          {weeks.map((w, i) => {
            const cx = L + band * i + band / 2;
            const ambient = w.total - w.chilled;
            const yc = y(w.chilled), ya = y(w.chilled + ambient);
            const base = y(0);
            return (
              <g key={w.iso_week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`Week ${w.iso_week}: ${w.total} m³ total, ${w.chilled} chilled, capacity ${w.chilled_capacity}`}>
                <rect x={L + band * i} y={T} width={band} height={H - T - B} fill={hover === i ? "#F2F4F7" : "transparent"} />
                <rect x={cx - bw / 2} y={yc} width={bw} height={base - yc} fill={CHILL} />
                <path d={roundTop(cx - bw / 2, ya, bw, yc - ya - 2, 4)} fill={AMBIENT} />
                <line x1={cx - bw / 2 - 5} x2={cx + bw / 2 + 5} y1={y(w.chilled_capacity)} y2={y(w.chilled_capacity)} stroke="#16233a" strokeWidth={2} />
                {w.chilled > w.chilled_capacity * 1.05 && (
                  <text x={cx} y={ya - 6} textAnchor="middle" fontSize={12} fill="#c23b2a" fontWeight={700}>
                    ▲
                  </text>
                )}
                <text x={cx} y={H - B + 16} textAnchor="middle" fontSize={11} fill="#16233a">
                  W{w.iso_week}
                </text>
                <text x={cx} y={H - B + 30} textAnchor="middle" fontSize={10} fill="#5d6b7e">
                  {w.festival ? w.festival.replace("_", " ") : weekStart(w.iso_week)}
                </text>
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-card px-3 py-2 text-xs shadow-sm" style={{ left: `${Math.min(((L + band * hover + band) / W) * 100, 68)}%` }}>
            <p className="font-semibold">
              Week {h.iso_week} · from {weekStart(h.iso_week)}
            </p>
            <p>Total {h.total.toLocaleString()} m³</p>
            <p>Chilled {h.chilled.toLocaleString()} m³ · capacity {h.chilled_capacity.toLocaleString()}</p>
            <p className="text-mute">
              {h.operating_days} operating days{h.paydays ? ` · ${h.paydays} payday` : ""}
              {h.festival ? ` · ${h.festival}` : ""}
            </p>
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-mute">Show as table</summary>
        <table className="mt-2 w-full text-right font-cond">
          <thead className="text-xs text-mute">
            <tr>
              <th className="text-left font-medium">Week</th>
              <th className="font-medium">Total m³</th>
              <th className="font-medium">Chilled m³</th>
              <th className="font-medium">Capacity m³</th>
              <th className="font-medium">Days</th>
              <th className="text-left pl-3 font-medium">Event</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.iso_week} className="border-t border-line/60">
                <td className="text-left">W{w.iso_week}</td>
                <td>{w.total}</td>
                <td className={w.chilled > w.chilled_capacity * 1.05 ? "font-bold text-late" : ""}>{w.chilled}</td>
                <td>{w.chilled_capacity}</td>
                <td>{w.operating_days}</td>
                <td className="pl-3 text-left">{w.festival || (w.paydays ? "payday" : "")}</td>
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

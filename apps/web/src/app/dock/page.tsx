"use client";

import Link from "next/link";
import { useState } from "react";
import { DepotToggle } from "@/components/DepotToggle";
import { Shell } from "@/components/Shell";
import { Card, Chip, IconChill } from "@/components/ui";
import { loadsFor } from "@/lib/rules";
import { seed, tripKey } from "@/lib/seed";
import { useDemo, type DemoState } from "@/lib/store";
import type { Order } from "@/lib/types";

type Status = "flagged" | "loading" | "todo" | "ready" | "left";
const LABEL: Record<Status, string> = { flagged: "Waiting for dispatcher", loading: "Loading", todo: "Not started", ready: "Ready", left: "Left the dock" };
const ORDER: Record<Status, number> = { flagged: 0, loading: 1, todo: 2, ready: 3, left: 4 };

function statusOf(s: DemoState, k: string, os: Order[]): Status {
  if (s.departed[k]) return "left";
  if (s.ready[k]) return "ready";
  if (os.some((o) => s.states[o.order_ref].loadFlag && !s.states[o.order_ref].loadDecision)) return "flagged";
  if (os.some((o) => s.states[o.order_ref].stage !== "planned")) return "loading";
  return "todo";
}

export default function DockQueue() {
  const { s } = useDemo();
  const [depot, setDepot] = useState(seed.personas.loader.depot);
  const [view, setView] = useState<"all" | Status>("all");

  const trips = seed.vehicles
    .filter((v) => v.depot === depot)
    .flatMap((v) =>
      loadsFor(v, s.orders).map((l) => {
        const k = tripKey(l);
        const os = l.orders;
        return { v, l, k, depart: seed.trips.find((t) => tripKey(t) === k)?.depart ?? "—", status: statusOf(s, k, os), loaded: os.filter((o) => s.states[o.order_ref].stage !== "planned").length };
      }),
    )
    .sort((a, b) => a.depart.localeCompare(b.depart) || ORDER[a.status] - ORDER[b.status] || a.v.vehicle_id.localeCompare(b.v.vehicle_id));
  const count = (st: Status) => trips.filter((t) => t.status === st).length;
  const shown = trips.filter((t) => view === "all" || t.status === view);
  const firstOut = trips.find((t) => t.status !== "left");

  return (
    <Shell width="medium" role="loader">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Dock queue · {depot}</h1>
          <p className="text-sm text-mute">{s.published ? `Plan version ${s.planVersion}. Lists update the moment the dispatcher changes the plan.` : "Waiting for tonight's plan."}</p>
        </div>
        <DepotToggle depot={depot} onChange={setDepot} />
      </div>

      {!s.published ? (
        <Card className="mt-4 p-6 text-center">
          <p className="font-cond text-2xl font-bold">Tonight&apos;s plan isn&apos;t published yet</p>
          <p className="mt-1 text-mute">Loading lists appear here as soon as the dispatcher publishes. There&apos;s nothing to print.</p>
        </Card>
      ) : (
        <>
          {s.planChangedAt && (
            <p className="mt-3 rounded-md bg-hivis px-4 py-2.5 font-semibold text-night" role="status">
              Plan updated {s.planChangedAt} (version {s.planVersion}). Re-check any vehicle you have already started.
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-5">
            {[
              { k: "Trips tonight", v: trips.length, sub: firstOut ? `next out ${firstOut.depart}` : "all gone" },
              { k: "Not started", v: count("todo") },
              { k: "Loading", v: count("loading") },
              { k: "Waiting on dispatcher", v: count("flagged"), bad: count("flagged") > 0 },
              { k: "Ready or left", v: count("ready") + count("left") },
            ].map((x) => (
              <div key={x.k} className="bg-card px-3 py-2">
                <dt className="text-xs text-mute">{x.k}</dt>
                <dd className={`font-cond text-2xl font-bold leading-tight ${x.bad ? "text-late" : ""}`}>{x.v}</dd>
                {x.sub && <dd className="text-xs text-mute">{x.sub}</dd>}
              </div>
            ))}
          </dl>

          <div role="radiogroup" aria-label="Show" className="mt-3 flex flex-wrap gap-1">
            {(["all", "todo", "loading", "flagged", "ready", "left"] as const).map((v) => (
              <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={`h-11 rounded-md border px-3 text-sm font-medium ${view === v ? "border-night bg-night text-white" : "border-line bg-card hover:border-night"}`}>
                {v === "all" ? "All" : LABEL[v]} <span className={view === v ? "text-white/70" : "text-mute"}>{v === "all" ? trips.length : count(v)}</span>
              </button>
            ))}
          </div>

          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map(({ v, l, k, depart, status, loaded }) => (
              <li key={k}>
                <Link href={`/dock/${v.vehicle_id}/${l.trip_id}`} className={`block h-full rounded-lg border bg-card p-4 transition-colors hover:border-night ${status === "flagged" ? "border-late" : k === firstOut?.k ? "border-2 border-night" : "border-line"}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-cond text-3xl font-bold">{v.vehicle_id}</span>
                    {v.temp === "reefer" && (
                      <span className="text-chill">
                        <IconChill className="size-6" />
                      </span>
                    )}
                    <span className="ml-auto">
                      <Chip tone={status === "flagged" ? "late" : status === "left" ? "ok" : status === "ready" ? "night" : status === "loading" ? "hivis" : "neutral"}>{status === "left" ? `Left ${s.departed[k]}` : LABEL[status]}</Chip>
                    </span>
                  </div>
                  <p className="mt-1 text-lg">
                    Trip {l.trip_id} · {l.brand} · {l.district}
                  </p>
                  <p className="text-mute">
                    Departs {depart} · {new Set(l.orders.map((o) => o.stop_seq)).size} stops · {l.volume.toFixed(1)} m³
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <div className="h-2 flex-1 overflow-hidden rounded-sm bg-line">
                      <div className={`h-full ${status === "flagged" ? "bg-late" : "bg-night"}`} style={{ width: `${(loaded / l.orders.length) * 100}%` }} />
                    </div>
                    <span className="font-semibold">
                      {loaded}/{l.orders.length}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="text-mute">No vehicles in this state.</li>}
          </ul>
        </>
      )}
    </Shell>
  );
}

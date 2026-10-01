"use client";

import { useState } from "react";
import { DepotToggle } from "@/components/DepotToggle";
import { Shell } from "@/components/Shell";
import { Btn, Card, Chip, IconCheck, IconChill, IconWrench, Meter } from "@/components/ui";
import { ASSUME, bestTrip, fmtRs } from "@/lib/business";
import { seed } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";

export default function Fleet() {
  const { s, dispatch } = useDemo();
  const [depot, setDepot] = useState("Peliyagoda");
  const [a, setA] = useState(ASSUME);

  const vehicles = seed.vehicles.filter((v) => v.depot === depot);
  const reefers = vehicles.filter((v) => v.temp === "reefer");
  const reefersUp = reefers.filter((v) => v.status === "available");
  const workshop = vehicles.filter((v) => v.status === "in_workshop");
  const deferred = s.orders.filter((o) => o.depot === depot && o.decision === "deferred");
  const chilledDeferred = deferred.filter((o) => o.temp_requirement === "chilled");
  const chilledDemand = s.orders.filter((o) => o.depot === depot && o.temp_requirement === "chilled").reduce((x, o) => x + o.order_volume_m3, 0);
  const chilledCap = reefersUp.reduce((x, v) => x + v.volume_cap_m3 * 2, 0);
  const crates = chilledDeferred.reduce((x, o) => x + o.order_units, 0);
  const lossPerCrate = a.crateValue * a.lossShare;

  // Repair priority: each workshop vehicle, in turn, takes the best trip left from tonight's deferrals.
  const ranked = workshop
    .map((v) => ({ v, alone: bestTrip(deferred, v.volume_cap_m3, v) }))
    .sort((x, y) => (y.alone?.crates ?? 0) - (x.alone?.crates ?? 0) || y.v.volume_cap_m3 - x.v.volume_cap_m3);
  const repairs: { v: (typeof workshop)[number]; trip: ReturnType<typeof bestTrip> }[] = [];
  let pool: Order[] = [...deferred];
  for (const r of ranked) {
    const trip = bestTrip(pool, r.v.volume_cap_m3, r.v);
    if (trip) {
      const taken = new Set(trip.orders.map((o) => o.order_ref));
      pool = pool.filter((o) => !taken.has(o.order_ref));
    }
    repairs.push({ v: r.v, trip });
  }
  const recovered = repairs.reduce((x, r) => x + (r.trip?.orders.length ?? 0), 0);

  const hire = bestTrip(chilledDeferred, a.hireM3, { type: "truck", temp: "reefer" });
  const protectedValue = (hire?.crates ?? 0) * lossPerCrate;
  const net = protectedValue - a.hireCostPerNight;
  const hired = s.fleet.hires.find((h) => h.district === hire?.district);

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">Fleet readiness</h1>
          <p className="text-sm text-mute">Refrigerated space is the constraint. Every refrigerated truck in the workshop is tonight&apos;s deferrals.</p>
        </div>
        <DepotToggle depot={depot} onChange={setDepot} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          { k: "Refrigerated vehicles running", v: `${reefersUp.length} of ${reefers.length}`, sub: `${reefers.length - reefersUp.length} in the workshop`, bad: reefersUp.length < reefers.length },
          { k: "Vehicles in the workshop", v: workshop.length, sub: `${workshop.filter((v) => v.temp === "reefer").length} of them refrigerated` },
          { k: "Chilled deferrals tonight", v: chilledDeferred.length, sub: `${crates.toLocaleString()} crates · ${chilledDeferred.reduce((x, o) => x + o.order_volume_m3, 0).toFixed(1)} m³`, bad: chilledDeferred.length > 0 },
          { k: "Value at risk tonight", v: fmtRs(crates * lossPerCrate), sub: "at the assumptions below" },
        ].map((x) => (
          <div key={x.k} className="bg-card px-4 py-3">
            <dt className="text-xs text-mute">{x.k}</dt>
            <dd className={`font-cond text-3xl font-bold leading-tight ${x.bad ? "text-late" : ""}`}>{x.v}</dd>
            <dd className="text-xs text-mute">{x.sub}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 max-w-xl">
        <Meter label="Chilled demand vs refrigerated capacity tonight (running vehicles, two trips each)" used={chilledDemand} cap={chilledCap} unit="m³" big />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <IconWrench className="size-5" />
            <div>
              <p className="font-cond text-lg font-semibold">Repair priority: fix these first</p>
              <p className="text-xs text-mute">Ranked by the deferred orders each vehicle could carry tonight if it were back. Share this list with the workshop.</p>
            </div>
          </div>
          {workshop.length === 0 ? (
            <p className="px-4 py-4 text-mute">No vehicles in the workshop at {depot}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper text-left text-xs text-mute">
                <tr>
                  <th className="px-2 py-2 font-medium sm:px-4">#</th>
                  <th className="px-2 py-2 font-medium">Vehicle</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">Capacity</th>
                  <th className="px-2 py-2 font-medium">If back tonight</th>
                  <th className="px-2 py-2 sm:px-4" />
                </tr>
              </thead>
              <tbody>
                {repairs.map(({ v, trip }, i) => {
                  const asked = s.fleet.repairs.includes(v.vehicle_id);
                  return (
                    <tr key={v.vehicle_id} className="border-t border-line">
                      <td className="px-2 py-2.5 font-cond text-lg font-bold sm:px-4">{i + 1}</td>
                      <td className="px-2 py-2.5">
                        <span className="inline-flex items-center gap-1 font-cond text-base font-bold">
                          {v.vehicle_id} {v.temp === "reefer" && <span className="text-chill"><IconChill className="size-4" /></span>}
                        </span>
                        <span className="block text-xs text-mute">{v.temp === "reefer" ? "Refrigerated" : "Ambient"} {v.type}<span className="sm:hidden"> · {v.volume_cap_m3} m³</span></span>
                      </td>
                      <td className="hidden px-2 py-2.5 font-cond sm:table-cell">{v.volume_cap_m3} m³</td>
                      <td className="px-2 py-2.5">
                        {trip ? (
                          <>
                            <span className="font-semibold">
                              {trip.orders.length} deferred {trip.orders.length === 1 ? "order" : "orders"} · {trip.crates.toLocaleString()} crates
                            </span>
                            <span className="block text-xs text-mute">
                              {trip.district}: {trip.orders.map((o) => o.outlet_id).join(", ")} · protects {fmtRs(trip.crates * lossPerCrate)}
                            </span>
                          </>
                        ) : (
                          <span className="text-mute">{v.temp === "reefer" ? "Nothing left it could carry" : "No ambient deferrals tonight"}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right sm:px-4">
                        {asked ? (
                          <Chip tone="ok"><IconCheck className="size-3.5" /> Workshop asked</Chip>
                        ) : trip ? (
                          <Btn onClick={() => dispatch({ type: "repair", vehicle_id: v.vehicle_id, note: `Workshop asked to prioritise ${v.vehicle_id}: back tonight it would carry ${trip.orders.length} deferred orders to ${trip.district}` })}>Ask workshop</Btn>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {workshop.length > 0 && (
            <p className="border-t border-line px-4 py-3 text-sm">
              Repairing the refrigerated vehicles in this order would recover <b>{recovered} of {deferred.length}</b> deferrals on a night like tonight. With Vesak a week away, that is the cheapest capacity Waypoint has.
            </p>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="font-cond text-lg font-semibold">Hire or defer, tonight</p>
            <p className="text-xs text-mute">Compares the cost of one hired refrigerated truck with the value lost if the orders wait a day.</p>
            {hire ? (
              <>
                <div className={`mt-3 rounded-md border-l-4 px-3 py-2 ${net > 0 ? "border-ok bg-ok-soft" : "border-line bg-paper"}`}>
                  <p className="font-semibold">{net > 0 ? `Hire: one truck for ${hire.district}` : "Defer: hiring costs more than it saves"}</p>
                  <p className="text-sm">
                    It would carry {hire.orders.length} orders ({hire.crates.toLocaleString()} crates, {hire.m3.toFixed(1)} m³): {hire.orders.map((o) => o.outlet_id).join(", ")}.
                  </p>
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-mute">Value protected</dt><dd className="font-cond font-semibold">{fmtRs(protectedValue)}</dd></div>
                  <div className="flex justify-between"><dt className="text-mute">Hire cost</dt><dd className="font-cond font-semibold">− {fmtRs(a.hireCostPerNight)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-1"><dt className="font-semibold">Net</dt><dd className={`font-cond text-lg font-bold ${net > 0 ? "text-ok" : "text-late"}`}>{fmtRs(net)}</dd></div>
                </dl>
                {hired ? (
                  <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-ok"><IconCheck /> Hire requested at {hired.at}</p>
                ) : (
                  <Btn variant={net > 0 ? "primary" : "secondary"} className="mt-3 w-full" onClick={() => dispatch({ type: "hire", district: hire.district, m3: hire.m3, cost: a.hireCostPerNight, note: `Hired refrigerated truck requested for ${hire.district} (${hire.orders.length} deferred orders, ${fmtRs(a.hireCostPerNight)}). Add it on the plan board when confirmed.` })}>
                    Request a hired truck
                  </Btn>
                )}
              </>
            ) : (
              <p className="mt-3 text-mute">No chilled deferrals at {depot} tonight.</p>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold">Assumptions</p>
            <p className="text-xs text-mute">Not in the supplied data. Replace with Waypoint&apos;s real figures during the pilot.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {([
                ["hireCostPerNight", "Hire cost per night (Rs)", 1000],
                ["hireM3", "Hired truck size (m³)", 1],
                ["crateValue", "Value of a chilled crate (Rs)", 100],
                ["lossShare", "Share lost if a day late", 0.01],
              ] as const).map(([k, label, step]) => (
                <label key={k} className="block">
                  <span className="text-xs text-mute">{label}</span>
                  <input type="number" step={step} value={a[k]} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) || 0 })} className="mt-0.5 h-9 w-full rounded-md border border-line px-2 font-cond text-base" />
                </label>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}

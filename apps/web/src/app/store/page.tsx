"use client";

import { OutletPicker, useOutlet } from "@/components/OutletPicker";
import { Shell } from "@/components/Shell";
import { BtnLink, Card, IconNoSignal, RelayTrack, stageChip } from "@/components/ui";
import { deferralConsequence, outletById, REASON_LABEL, seed, tripKey, vehicleById } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";

export default function MyDeliveries() {
  const { s } = useDemo();
  const [outletId, setOutlet] = useOutlet();
  const outlet = outletById.get(outletId)!;
  const orders = s.orders.filter((o) => o.outlet_id === outletId);
  const placed = s.placed.filter((o) => o.outlet_id === outletId);

  return (
    <Shell width="medium" role="store" who={`${seed.personas.store.name} · ${outlet.brand} ${outlet.district}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-cond text-3xl font-bold">My deliveries</h1>
        <OutletPicker id={outletId} onChange={setOutlet} />
      </div>
      <p className="text-mute">
        Friday 24 April · receiving window {outlet.window_open_time}–{outlet.window_close_time}
        {outlet.mall_window ? ` · mall bay ${outlet.mall_window}` : ""}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {orders.length === 0 && <Card className="p-4 text-mute">No orders for Friday&apos;s run at this outlet.</Card>}
          {orders.map((o) => (
            <OrderCard key={o.order_ref} o={o} />
          ))}
          {placed.length > 0 && (
            <>
              <h2 className="pt-2 font-cond text-xl font-semibold">Next run</h2>
              {placed.map((o) => (
                <Card key={o.order_ref} className="p-4">
                  <p className="font-semibold">
                    {o.order_ref} · {o.temp_requirement === "chilled" ? "Chilled" : "Dry"} · {o.order_units} {o.brand === "Fresh" ? "crates" : "units"}
                  </p>
                  <p className="text-sm text-mute">Received by Waypoint. It will be planned after the 16:00 cutoff.</p>
                  <div className="mt-3">
                    <RelayTrack st={{ stage: "ordered", deferred: false }} compact />
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
        <Glance outletId={outletId} />
      </div>
    </Shell>
  );
}

function Glance({ outletId }: { outletId: string }) {
  const { s } = useDemo();
  const outlet = outletById.get(outletId)!;
  const orders = s.orders.filter((o) => o.outlet_id === outletId);
  const coming = orders.filter((o) => o.decision === "served");
  const first = [...coming].sort((a, b) => (a.pred_arrival ?? "").localeCompare(b.pred_arrival ?? ""))[0];
  const deferred = orders.filter((o) => o.decision === "deferred");
  const notices = s.feed.filter((f) => f.ref && orders.some((o) => o.order_ref === f.ref)).slice(0, 4);
  const rows: [string, React.ReactNode][] = [
    ["Receiving window", `${outlet.window_open_time}–${outlet.window_close_time}${outlet.mall_window ? ` (mall bay ${outlet.mall_window})` : ""}`],
    ["First arrival", s.published && first ? `${first.pred_window}${(first.pred_late_prob ?? 0) >= 0.5 ? ", likely late" : ""}` : "After the plan is published"],
    ["Orders coming", s.published ? `${coming.length} of ${orders.length}` : `${orders.length} confirmed`],
    ["Deferred", s.published ? (deferred.length ? `${deferred.length}, arriving Sat 25 Apr` : "None") : "—"],
    ["Unloading", { rear_dock: "Rear dock", street: "Curbside", mall_bay: "Shared mall bay" }[outlet.dock_type]],
  ];
  return (
    <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
      <Card>
        <p className="border-b border-line px-4 py-2.5 font-cond text-lg font-semibold">
          {outlet.outlet_id} at a glance
        </p>
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-4 py-2">
              <dt className="text-mute">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line p-3">
          <BtnLink href="/store/order" variant="primary" className="w-full">
            Place an order for the next run
          </BtnLink>
        </div>
      </Card>
      <Card>
        <p className="border-b border-line px-4 py-2.5 text-sm font-semibold">Notices for this outlet</p>
        <ul className="divide-y divide-line text-sm">
          {notices.length === 0 && <li className="px-4 py-3 text-mute">No changes so far. Anything that affects your delivery shows up here.</li>}
          {notices.map((f) => (
            <li key={f.id} className="px-4 py-2">
              <span className="text-xs text-mute">{f.at}</span>
              <span className="block">{f.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}

function OrderCard({ o }: { o: Order }) {
  const { s } = useDemo();
  const st = s.states[o.order_ref];
  const unit = o.brand === "Fresh" ? "crates" : "units";
  const onDriverRun = tripKey(o) === `${seed.personas.driver.vehicle_id}#${seed.personas.driver.trip_id}`;
  const driverOffline = onDriverRun && !s.driver.online && st.stage === "on_road";
  const v = o.vehicle_id ? vehicleById.get(o.vehicle_id) : undefined;
  const stops = new Set(s.orders.filter((x) => tripKey(x) === tripKey(o) && x.decision === "served").map((x) => x.stop_seq)).size;
  const likelyLate = (o.pred_late_prob ?? 0) >= 0.5;

  let line: React.ReactNode;
  if (!s.published) line = <>Confirmed. You&apos;ll see the arrival time here once tonight&apos;s plan is published, usually by 16:30.</>;
  else if (st.deferred)
    line = (
      <>
        <span className="font-semibold text-late">Not coming on Friday&apos;s run. </span>
        {deferralConsequence(o)} Reason: {REASON_LABEL[o.reason ?? "dispatcher_choice"].toLowerCase()}. Moved to <b>Saturday 25 April</b>, and you are first in line.
      </>
    );
  else if (st.receipt) line = st.receipt.ok ? <>Received in full. Thank you.</> : <>You reported {st.receipt.issue?.qty} × {st.receipt.issue?.kind}. The dispatcher has it.</>;
  else if (st.stage === "delivered")
    line = (
      <>
        Delivered at {st.deliveredAt}: {st.deliveredUnits} of {o.order_units} {unit}, signed by {st.pod?.name}.{st.recordedOffline ? " Recorded on the driver's phone without signal and sent later." : ""}
      </>
    );
  else if (driverOffline)
    line = (
      <span className="inline-flex gap-2">
        <IconNoSignal className="mt-0.5 size-4 shrink-0" />
        <span>Your driver has no signal on this route. Expected {o.pred_window}. Delivery records appear when they reconnect, and you can still confirm receipt yourself.</span>
      </span>
    );
  else if (st.loadDecision === "send_short") line = <>Arriving {o.pred_window}, <b>short by {st.loadFlag?.qty} {unit}</b> (not in stock at the warehouse). The balance comes on the next run.</>;
  else if (st.stage === "on_road") line = <>On the way: {v?.vehicle_id}, stop {o.stop_seq} of {stops}. Expected {o.pred_window}{likelyLate ? ", later than your window closes" : ""}.</>;
  else if (likelyLate)
    line = (
      <>
        Expected <b>{o.pred_window}</b> on {v?.vehicle_id}, stop {o.stop_seq} of {stops}. That is <b>after your window closes at {o.window_close_time}</b>; keep a receiver on until it arrives. The dispatcher sees the same estimate.
      </>
    );
  else line = <>Arriving {o.pred_window} on {v?.vehicle_id}, stop {o.stop_seq} of {stops}. Plan your receiving staff for then.</>;

  return (
    <Card className={`p-4 ${st.deferred && s.published ? "border-late/50" : ""}`}>
      <div className="flex items-center gap-2">
        <p className="font-semibold">
          {o.temp_requirement === "chilled" ? "Chilled order" : o.brand === "Fresh" ? "Dry goods order" : `${o.brand} order`} · {o.order_units} {unit}
        </p>
        <span className="ml-auto">{s.published ? stageChip(st) : stageChip({ stage: "ordered", deferred: false })}</span>
      </div>
      <p className="mt-1 text-sm text-mute">{o.order_ref}</p>
      <div className="mt-3">
        <RelayTrack st={s.published ? st : { stage: "ordered", deferred: false }} pending={driverOffline} />
      </div>
      <p className="mt-3">{line}</p>
      {s.published && (st.stage === "delivered" || (driverOffline && !st.receipt)) && !st.receipt && (
        <BtnLink href={`/store/receive/${o.order_ref}`} variant="primary" className="mt-3">
          Confirm what arrived
        </BtnLink>
      )}
    </Card>
  );
}

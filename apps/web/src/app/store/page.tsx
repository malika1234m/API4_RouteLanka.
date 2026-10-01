"use client";

import { OutletPicker, useOutlet } from "@/components/OutletPicker";
import { demoWhatsAppNumber, formatPhone } from "@routelanka/domain";
import { Shell } from "@/components/Shell";
import { Btn, BtnLink, Card, IconChat, IconCheck, IconLock, IconNoSignal, RelayTrack, Rich, stageChip } from "@/components/ui";
import { deferralConsequence, outletById, REASON_LABEL, seed, tripKey, vehicleById } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { Order } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { delayedEta } from "@/lib/delay";

export default function MyDeliveries() {
  const { s } = useDemo();
  const { t } = useT("store");
  const [outletId, setOutlet] = useOutlet();
  const outlet = outletById.get(outletId)!;
  const orders = s.orders.filter((o) => o.outlet_id === outletId);
  const placed = s.placed.filter((o) => o.outlet_id === outletId);

  return (
    <Shell width="medium" role="store" who={`${seed.personas.store.name} · ${outlet.brand} ${outlet.district}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-cond text-3xl font-bold">{t("My deliveries")}</h1>
        <OutletPicker id={outletId} onChange={setOutlet} />
      </div>
      <p className="text-mute">
        {t("Friday 24 April · receiving window {a}–{b}", { a: outlet.window_open_time, b: outlet.window_close_time })}
        {outlet.mall_window ? ` · ${t("mall bay {w}", { w: outlet.mall_window })}` : ""}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {orders.length === 0 && <Card className="p-4 text-mute">{t("No orders for Friday's run at this outlet.")}</Card>}
          {orders.map((o) => (
            <OrderCard key={o.order_ref} o={o} />
          ))}
          {placed.length > 0 && (
            <>
              <h2 className="pt-2 font-cond text-xl font-semibold">{t("Next run")}</h2>
              {placed.map((o) => (
                <Card key={o.order_ref} className="p-4">
                  <p className="font-semibold">
                    {o.order_ref} · {t(o.temp_requirement === "chilled" ? "Chilled" : "Dry")} · {o.order_units} {t(o.brand === "Fresh" ? "crates" : "units")}
                  </p>
                  <p className="text-sm text-mute">{t("Received by Waypoint. It will be planned after the 16:00 cutoff.")}</p>
                  <div className="mt-3">
                    <RelayTrack st={{ stage: "ordered", deferred: false }} compact t={t} />
                  </div>
                </Card>
              ))}
            </>
          )}
          <DeliveryRecord outletId={outletId} />
        </div>
        <Glance outletId={outletId} />
      </div>
    </Shell>
  );
}

/** The outlet's real delivery record from the supplied history, so the store knows what to expect. */
function DeliveryRecord({ outletId }: { outletId: string }) {
  const h = seed.outlet_history[outletId];
  const { t } = useT("store");
  if (!h) return null;
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const colour = { on_time: "bg-ok", late: "bg-hivis", missed: "bg-late" } as const;
  const word = { on_time: "On time", late: "Late", missed: "Missed the run" } as const;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-cond text-lg font-semibold">{t("Your delivery record")}</p>
        <p className="text-xs text-mute">
          {t("Last {n} orders on file", { n: h.runs })} · {fmt(h.since)} – {fmt(h.until)}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line text-center">
        {[
          ["On time", `${h.on_time}%`, "text-ok"],
          ["Late", `${h.late}%`, h.late >= 15 ? "text-late" : ""],
          ["Missed a run", String(h.missed), h.missed ? "text-late" : ""],
        ].map(([k, v, c]) => (
          <div key={k} className="bg-card px-2 py-2">
            <dt className="text-xs text-mute">{t(k)}</dt>
            <dd className={`font-cond text-2xl font-bold ${c}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-mute">{t("Last {n} delivery days, oldest first", { n: h.recent.length })}</p>
      <div className="mt-1 flex gap-1" role="list" aria-label="Recent delivery days">
        {h.recent.map((r) => (
          <span key={r.date} role="listitem" title={`${fmt(r.date)}: ${t(word[r.state])}`} aria-label={`${fmt(r.date)}: ${t(word[r.state])}`} className={`h-6 flex-1 rounded-sm ${colour[r.state]}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-mute">
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-ok" /> {t("On time")}</span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-hivis" /> {t("Late")}</span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-late" /> {t("Missed the run")}</span>
        {h.late_median != null && <span className="ml-auto">{t("When late, typically {n} min after the window closes", { n: h.late_median })}</span>}
      </div>
    </Card>
  );
}

function Glance({ outletId }: { outletId: string }) {
  const { s } = useDemo();
  const { t } = useT("store");
  const outlet = outletById.get(outletId)!;
  const orders = s.orders.filter((o) => o.outlet_id === outletId);
  const coming = orders.filter((o) => o.decision === "served");
  const first = [...coming].sort((a, b) => (a.pred_arrival ?? "").localeCompare(b.pred_arrival ?? ""))[0];
  const deferred = orders.filter((o) => o.decision === "deferred");
  const notices = s.feed.filter((f) => f.ref && orders.some((o) => o.order_ref === f.ref)).slice(0, 4);
  const rows: [string, React.ReactNode][] = [
    ["Receiving window", `${outlet.window_open_time}–${outlet.window_close_time}${outlet.mall_window ? ` (${t("mall bay {w}", { w: outlet.mall_window })})` : ""}`],
    ["First arrival", s.published && first ? `${first.pred_window}${(first.pred_late_prob ?? 0) >= 0.5 ? t(", likely late") : ""}` : t("After the plan is published")],
    ["Orders coming", s.published ? t("{a} of {b}", { a: coming.length, b: orders.length }) : t("{n} confirmed", { n: orders.length })],
    ["Deferred", s.published ? (deferred.length ? t("{n}, arriving Sat 25 Apr", { n: deferred.length }) : t("None")) : "—"],
    ["Unloading", t({ rear_dock: "Rear dock", street: "Curbside", mall_bay: "Shared mall bay" }[outlet.dock_type])],
  ];
  return (
    <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
      <Card>
        <p className="border-b border-line px-4 py-2.5 font-cond text-lg font-semibold">
          {t("{o} at a glance", { o: outlet.outlet_id })}
        </p>
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-4 py-2">
              <dt className="text-mute">{t(k)}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line p-3">
          <BtnLink href="/store/order" variant="primary" className="w-full">
            {t("Place an order for the next run")}
          </BtnLink>
        </div>
      </Card>
      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 place-items-center rounded-full bg-[#25d366] text-white"><IconChat className="size-4" /></span>
          {t("Updates by WhatsApp")}
        </p>
        <p className="mt-1 text-sm text-mute">{formatPhone(demoWhatsAppNumber(outletId))}</p>
        <p className="mt-1 text-xs text-mute">{t("Messages are sent in the store's chosen language. No app to install: outlet staff change often.")}</p>
        <BtnLink href="/store/messages" className="mt-3 w-full">
          {t("Open messages")}
        </BtnLink>
        <a href={`/wa-sim?phone=${demoWhatsAppNumber(outletId)}`} target="_blank" rel="noreferrer" className="mt-2 block text-center text-xs font-semibold text-[#027eb5] underline">
          See it on this store&apos;s phone (WhatsApp simulator)
        </a>
      </Card>
      <Card>
        <p className="border-b border-line px-4 py-2.5 text-sm font-semibold">{t("Notices for this outlet")}</p>
        <ul className="divide-y divide-line text-sm">
          {notices.length === 0 && <li className="px-4 py-3 text-mute">{t("No changes so far. Anything that affects your delivery shows up here.")}</li>}
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
  const { s, dispatch } = useDemo();
  const { t } = useT("store");
  const st = s.states[o.order_ref];
  const unit = t(o.brand === "Fresh" ? "crates" : "units");
  const onDriverRun = tripKey(o) === `${seed.personas.driver.vehicle_id}#${seed.personas.driver.trip_id}`;
  const driverOffline = onDriverRun && !s.driver.online && st.stage === "on_road";
  const v = o.vehicle_id ? vehicleById.get(o.vehicle_id) : undefined;
  const stops = new Set(s.orders.filter((x) => tripKey(x) === tripKey(o) && x.decision === "served").map((x) => x.stop_seq)).size;
  const likelyLate = (o.pred_late_prob ?? 0) >= 0.5;

  let line: React.ReactNode;
  if (!s.published) line = t("Confirmed. You'll see the arrival time here once tonight's plan is published, usually by 16:30.");
  else if (st.deferred)
    line = <Rich text={t("**Not coming on Friday's run.** {c} Reason: {r}. Moved to **Saturday 25 April**, and you are first in line.", { c: t(deferralConsequence(o)), r: t(REASON_LABEL[o.reason ?? "dispatcher_choice"].toLowerCase()) })} />;
  else if (st.receipt) line = st.receipt.ok ? t("Received in full. Thank you.") : t("You reported {q} × {k}. The dispatcher has it.", { q: st.receipt.issue?.qty, k: t(st.receipt.issue?.kind ?? "") });
  else if (st.stage === "delivered")
    line =
      (st.pod?.method === "code"
        ? t("Delivered at {t}: {a} of {b} {u}, verified with your handover code.", { t: st.deliveredAt, a: st.deliveredUnits, b: o.order_units, u: unit })
        : t("Delivered at {t}: {a} of {b} {u}, signed by {n}.", { t: st.deliveredAt, a: st.deliveredUnits, b: o.order_units, u: unit, n: st.pod?.name })) + (st.recordedOffline ? t(" Recorded on the driver's phone without signal and sent later.") : "");
  else if (s.delayPlan[o.order_ref] && s.delayToldAt) {
    const plan = s.delayPlan[o.order_ref];
    const eta = delayedEta(s, o);
    const reply = s.storeReplies[o.order_ref];
    line = (
      <Rich
        text={
          (plan === "late"
            ? t("Your delivery is held up on the way ({r}). New estimate **{w}**.", { r: t("road disruption"), w: eta ? `${eta.from}–${eta.to}` : "" }) + (eta?.late ? " " + t("That is after your window closes at {c}.", { c: o.window_close_time }) : "")
            : plan === "move"
              ? t("Your delivery is held up on the way ({r}), so it now comes on **{v}**. We'll confirm the time when it leaves.", { r: t("road disruption"), v: st.reassignedTo })
              : t("Your {k} delivery can't reach you before you open ({r}). It goes back to the depot and comes on **tomorrow's first run**; you're first in line.", { k: t(o.temp_requirement === "chilled" ? "chilled" : "dry goods"), r: t("road disruption") })) + (reply ? ` ${t(reply.reply === "wait" ? "You said you'll wait." : "You asked for tomorrow instead.")}` : "")
        }
      />
    );
  } else if (driverOffline)
    line = (
      <span className="inline-flex gap-2">
        <IconNoSignal className="mt-0.5 size-4 shrink-0" />
        <span>{t("Your driver has no signal on this route. Expected {w}. Delivery records appear when they reconnect, and you can still confirm receipt yourself.", { w: o.pred_window })}</span>
      </span>
    );
  else if (st.loadDecision === "send_short") line = <Rich text={t("Arriving {w}, **short by {q} {u}** (not in stock at the warehouse). The balance comes on the next run.", { w: o.pred_window, q: st.loadFlag?.qty, u: unit })} />;
  else if (st.stage === "on_road") line = t("On the way: {v}, stop {n} of {m}. Expected {w}.", { v: v?.vehicle_id, n: o.stop_seq, m: stops, w: o.pred_window });
  else if (likelyLate) line = <Rich text={t("Expected **{w}** on {v}, stop {n} of {m}. That is **after your window closes at {c}**; keep a receiver on until it arrives. The dispatcher sees the same estimate.", { w: o.pred_window, v: v?.vehicle_id, n: o.stop_seq, m: stops, c: o.window_close_time })} />;
  else line = t("Arriving {w} on {v}, stop {n} of {m}. Plan your receiving staff for then.", { w: o.pred_window, v: v?.vehicle_id, n: o.stop_seq, m: stops });
  const showCode = s.published && !st.deferred && !st.receipt && st.stage !== "delivered";

  return (
    <Card className={`p-4 ${st.deferred && s.published ? "border-late/50" : ""}`}>
      <div className="flex items-center gap-2">
        <p className="font-semibold">
          {o.temp_requirement === "chilled" ? t("Chilled order") : o.brand === "Fresh" ? t("Dry goods order") : t("{b} order", { b: o.brand })} · {o.order_units} {unit}
        </p>
        <span className="ml-auto">{s.published ? stageChip(st, t) : stageChip({ stage: "ordered", deferred: false }, t)}</span>
      </div>
      <p className="mt-1 text-sm text-mute">{o.order_ref}</p>
      <div className="mt-3">
        <RelayTrack st={s.published ? st : { stage: "ordered", deferred: false }} pending={driverOffline} t={t} />
      </div>
      <p className="mt-3">{line}</p>
      {showCode && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-line bg-paper px-3 py-2">
          <IconLock className="size-5 shrink-0 text-mute" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("Handover code for this delivery")}</span>
            <span className="block text-xs text-mute">{t("Give it to the driver only when the goods are in front of you. It works even when the driver has no signal.")}</span>
          </span>
          <span className="font-cond text-2xl font-bold tracking-[0.3em]">{s.codes?.[o.order_ref] ?? "····"}</span>
        </div>
      )}
      {s.published && st.deferred && (
        s.acks[o.order_ref] ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ok"><IconCheck /> {t("Acknowledged {t}", { t: s.acks[o.order_ref] })}</p>
        ) : (
          <Btn className="mt-3" onClick={() => dispatch({ type: "ack", ref: o.order_ref, via: "app" })}>
            <IconCheck /> {t("Noted, thanks")}
          </Btn>
        )
      )}
      {s.published && (st.stage === "delivered" || (driverOffline && !st.receipt)) && !st.receipt && (
        <BtnLink href={`/store/receive/${o.order_ref}`} variant="primary" className="mt-3">
          {t("Confirm what arrived")}
        </BtnLink>
      )}
    </Card>
  );
}

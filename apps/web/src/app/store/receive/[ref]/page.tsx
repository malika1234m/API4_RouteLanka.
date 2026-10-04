"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Btn, BtnLink, Card, Chip, IconBack, IconCheck, RelayTrack } from "@/components/ui";
import { delayOn } from "@/lib/delay";
import { runFor } from "@/lib/runs";
import { outletById, tripKey, vehicleById } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { LineIssue } from "@/lib/types";
import { useT } from "@/lib/i18n";

type Mode = "ok" | LineIssue["kind"];
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "ok", label: "All correct", hint: "Everything the driver recorded arrived in good condition" },
  { id: "short", label: "Short", hint: "Fewer units than the driver recorded" },
  { id: "damaged", label: "Damaged", hint: "Arrived but can't be sold" },
  { id: "temperature", label: "Temperature issue", hint: "Chilled goods arrived warm" },
];

export default function Receive() {
  const { ref } = useParams<{ ref: string }>();
  const router = useRouter();
  const { s, dispatch } = useDemo();
  const { t } = useT("store");
  const o = s.orders.find((x) => x.order_ref === ref);
  const st = o ? s.states[o.order_ref] : undefined;
  const [mode, setMode] = useState<Mode>("ok");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  if (!o || !st)
    return (
      <Shell width="medium" role="store">
        <Card className="p-5">
          <p className="font-semibold">{t("This order isn't on today's run.")}</p>
          <BtnLink href="/store" className="mt-3">
            {t("Back to my deliveries")}
          </BtnLink>
        </Card>
      </Shell>
    );

  const unit = t(o.brand === "Fresh" ? "crates" : "units");
  const outlet = outletById.get(o.outlet_id)!;
  const v = o.vehicle_id ? vehicleById.get(o.vehicle_id) : undefined;
  const recorded = st.deliveredUnits;
  const gap = recorded !== undefined ? o.order_units - recorded : 0;
  const expected = recorded ?? o.order_units;
  const phone = o.vehicle_id ? runFor(s, tripKey(o)) : undefined;
  const offlineRoute = !!phone && !phone.online;
  const choices = MODES.filter((m) => m.id !== "temperature" || o.temp_requirement === "chilled");

  if (st.receipt)
    return (
      <Shell width="medium" role="store">
        <Card className="mx-auto max-w-xl p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-ok text-white">
            <IconCheck className="size-6" />
          </span>
          <p className="mt-3 font-cond text-2xl font-bold">{t("Receipt confirmed")}</p>
          <p className="mt-1 text-mute">{st.receipt.ok ? t("Recorded as received in full.") : t("You reported {q} × {k}. The dispatcher has it and will arrange a credit or redelivery.", { q: st.receipt.issue?.qty, k: t(st.receipt.issue?.kind ?? "") })}</p>
          <BtnLink href="/store" variant="primary" className="mt-4">
            {t("Back to my deliveries")}
          </BtnLink>
        </Card>
      </Shell>
    );

  return (
    <Shell width="medium" role="store">
      <BtnLink href="/store" variant="ghost" className="-ml-3">
        <IconBack /> {t("My deliveries")}
      </BtnLink>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-cond text-2xl font-bold leading-tight">{t("Confirm what arrived")}</h1>
          <p className="text-sm text-mute">
            {t("{o} · {r} · {k} order", { o: outlet.outlet_id, r: o.order_ref, k: o.temp_requirement === "chilled" ? t("Chilled") : o.brand === "Fresh" ? t("Dry goods") : o.brand })}
          </p>
        </div>
        <div className="w-full max-w-md">
          <RelayTrack st={st} t={t} />
        </div>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
        <Card>
          <p className="border-b border-line px-4 py-2.5 font-cond text-lg font-semibold">{t("What the driver recorded")}</p>
          {recorded !== undefined ? (
            <dl className="divide-y divide-line text-sm">
              {[
                ["Ordered", `${o.order_units} ${unit}`],
                ["Handed over", <span key="h" className={gap ? "font-semibold text-late" : ""}>{`${recorded} ${unit}${gap ? ` ${t("({n} short)", { n: gap })}` : ""}`}</span>],
                ["Delivered at", st.deliveredAt],
                ["Proof", st.pod?.method === "code" ? <span key="p" className="inline-flex items-center gap-1 font-semibold text-ok"><IconCheck className="size-4" /> {t("Code {c} matched", { c: st.pod.code })}</span> : t("Signed by {n}", { n: st.pod?.name })],
                ["Vehicle", v ? `${v.vehicle_id} · ${v.temp === "reefer" ? "refrigerated " : ""}${v.type}` : "—"],
                ["Driver noted", st.exception ? <Chip key="e" tone="late">{t(st.exception)}</Chip> : t("Nothing")],
                ["Sent", st.recordedOffline ? t("Later, at {t} (no signal on the road)", { t: st.syncedAt }) : t("Straight away")],
              ].map(([k, val]) => (
                <div key={String(k)} className="flex justify-between gap-3 px-4 py-2">
                  <dt className="text-mute">{t(String(k))}</dt>
                  <dd className="text-right font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="text-sm">
              <p className={`m-4 rounded-md border px-3 py-2 ${offlineRoute ? "border-hivis bg-amber-soft" : "border-line bg-paper"}`}>
                {t(offlineRoute
                  ? "The driver's record hasn't arrived yet. Their phone has no signal on this route."
                  : st.stage === "on_road"
                    ? "The vehicle is on its way. The driver hasn't recorded this delivery yet."
                    : "The driver hasn't recorded this delivery yet.")}
              </p>
              <dl className="divide-y divide-line border-t border-line">
                {[
                  ["Ordered", `${o.order_units} ${unit}`],
                  ["Expected", o.pred_window ?? "—"],
                  ["Vehicle", v ? `${v.vehicle_id} · ${t("stop {n}", { n: o.stop_seq })}` : "—"],
                  ["Status", t(st.stage === "on_road" ? "On the way" : st.stage === "loaded" ? "Loaded at the dock" : "Planned")],
                ].map(([k, val]) => (
                  <div key={k} className="flex justify-between gap-3 px-4 py-2">
                    <dt className="text-mute">{t(k)}</dt>
                    <dd className="text-right font-medium">{val}</dd>
                  </div>
                ))}
              </dl>
              <p className="px-4 py-3 text-mute">{t("You can still confirm what you received. Your confirmation is matched to the driver's record when it arrives, and any difference goes to the dispatcher.")}</p>
            </div>
          )}
        </Card>
        {/* The timeline fills whichever column is shorter. */}
        {mode !== "ok" && <Timeline orderRef={o.order_ref} />}
        </div>

        <div className="space-y-4">
        <Card className="p-4">
          <p className="font-cond text-lg font-semibold">{t("Your confirmation")}</p>
          <fieldset className="mt-2">
            <legend className="text-sm font-semibold">{t("Is that what you received?")}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {choices.map((m) => (
                <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`rounded-md border px-3 py-2.5 text-left ${mode === m.id ? (m.id === "ok" ? "border-ok bg-ok-soft" : "border-late bg-late-soft") : "border-line bg-card hover:border-night"}`}>
                  <span className="block font-semibold">{t(m.label)}</span>
                  <span className="block text-xs text-mute">{t(m.hint)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {mode !== "ok" && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">{t("How many {u}?", { u: unit })}</span>
                <Btn size="lg" className="!w-12" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">
                  −
                </Btn>
                <span className="w-10 text-center font-cond text-3xl font-bold" aria-live="polite">
                  {qty}
                </span>
                <Btn size="lg" className="!w-12" onClick={() => setQty((q) => Math.min(expected, q + 1))} aria-label="More">
                  +
                </Btn>
                <span className="text-sm text-mute">{t("of {n}", { n: expected })}</span>
              </div>
              <label className="block">
                <span className="text-sm font-semibold">{t("Note for the dispatcher (optional)")}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("For example: two yoghurt crates split open")} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" />
              </label>
              <div>
                <span className="text-sm font-semibold">{t("Photo (optional)")}</span>
                <div className="mt-1 flex items-center gap-3">
                  <label className="inline-flex h-11 cursor-pointer items-center rounded-md border border-line bg-card px-3 text-sm font-semibold hover:border-night">
                    {t(photo ? "Replace photo" : "Add photo")}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setPhoto(URL.createObjectURL(f));
                      }}
                    />
                  </label>
                  {photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="Attached evidence" className="size-11 rounded-md border border-line object-cover" />
                  )}
                </div>
              </div>
            </div>
          )}

          <Btn
            variant="primary"
            size="lg"
            className="mt-5 w-full"
            onClick={() => {
              dispatch({ type: "receive", ref: o.order_ref, ok: mode === "ok", issue: mode === "ok" ? undefined : { kind: mode, qty, note: note.trim() || undefined } });
              router.push("/store");
            }}
          >
            {mode === "ok" ? t("Confirm receipt") : t("Report {q} {k} and confirm the rest", { q: qty, k: t(mode) })}
          </Btn>
          <p className="mt-2 text-center text-xs text-mute">{t("The dispatcher sees this straight away. You can't change it after confirming.")}</p>
        </Card>
        {mode === "ok" && <Timeline orderRef={o.order_ref} />}
        </div>
      </div>
    </Shell>
  );
}

/** What happened to this order, step by step, from the shared record. */
function Timeline({ orderRef }: { orderRef: string }) {
  const { s } = useDemo();
  const { t } = useT("store");
  const o = s.orders.find((x) => x.order_ref === orderRef)!;
  const st = s.states[orderRef];
  const published = [...s.feed].reverse().find((f) => f.text.startsWith("Plan published"))?.at;
  const left = s.departed[tripKey(o)];
  const steps: [string, string | undefined, string][] = [
    ["Order confirmed", "before 16:00", "Received by Waypoint before the cutoff"],
    ["Planned", published, t("On {v}, stop {n}", { v: o.vehicle_id, n: o.stop_seq })],
    ["Left the dock", left, "Loaded in stop order and released"],
    ...(delayOn(s, o) && s.delayPlan[o.order_ref] ? ([["Held up on the road", delayOn(s, o)!.at, "Road disruption reported by the driver; you were told the new time"]] as [string, string | undefined, string][]) : []),
    ["Delivered", st.deliveredAt, st.pod?.method === "code" ? "Verified with your handover code" : st.pod?.name ? t("Signed by {n}", { n: st.pod.name }) : "Waiting for the driver's record"],
    ["Record sent", st.recordedOffline ? st.syncedAt : st.deliveredAt, st.recordedOffline ? "Recorded without signal, sent when the phone reconnected" : "Sent straight away"],
    ["Received", undefined, "Waiting for your confirmation"],
  ];
  return (
    <Card className="p-4">
      <p className="font-cond text-lg font-semibold">{t("What happened to this order")}</p>
      <ol className="mt-3">
        {steps.map(([title, at, d], i) => {
          const done = !!at && title !== "Received";
          return (
            <li key={title} className="relative flex gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && <span aria-hidden className={`absolute left-[9px] top-5 h-full w-0.5 ${done ? "bg-night" : "bg-line"}`} />}
              <span className={`relative z-10 mt-0.5 size-5 shrink-0 rounded-full border-2 ${done ? "border-night bg-night" : title === "Received" ? "border-hivis bg-amber-soft" : "border-line bg-card"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-3 text-sm font-semibold">
                  {t(title)}
                  <span className="font-cond text-mute">{at ? t(at) : ""}</span>
                </span>
                <span className="block text-sm text-mute">{t(d)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

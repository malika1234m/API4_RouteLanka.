"use client";

import { useParams, useRouter } from "next/navigation";
import { useRef, useState, type PointerEvent } from "react";
import { Shell } from "@/components/Shell";
import { SyncChip } from "@/components/SyncChip";
import { Btn, BtnLink, Card, IconBack, IconCheck, IconLock, OrderMarks } from "@/components/ui";
import { driverState } from "@/lib/driver";
import { outletById, seed, tripKey } from "@/lib/seed";
import { newEvent, useDemo } from "@/lib/store";
import type { OrderState } from "@/lib/types";
import { codeMatches } from "@routelanka/domain";
import { useT } from "@/lib/i18n";

type Exc = NonNullable<OrderState["exception"]> | "none";

export default function StopFlow() {
  const { ref } = useParams<{ ref: string }>();
  const router = useRouter();
  const { s, dispatch } = useDemo();
  const { t } = useT("driver");
  const o = s.orders.find((x) => x.order_ref === ref);
  const st = o ? driverState(s, o.order_ref) : undefined;
  const shortAtDock = o && s.states[o.order_ref]?.loadDecision === "send_short" ? s.states[o.order_ref].loadFlag?.qty ?? 0 : 0;
  const [units, setUnits] = useState((o?.order_units ?? 0) - shortAtDock);
  const [exc, setExc] = useState<Exc>("none");
  const [name, setName] = useState("");
  const [signed, setSigned] = useState(false);
  const [padKey, setPadKey] = useState(0);
  const [code, setCode] = useState("");
  const [useSig, setUseSig] = useState(false);

  if (!o || !st) return <Shell role="driver" who={seed.personas.driver.name}>{t("Stop not found.")}</Shell>;
  // The phone holds only a hash of the store's code, so it can check it with no signal.
  const codeOk = codeMatches(o.order_ref, code, s.codeHashes?.[o.order_ref]);
  const canSave = useSig ? !!name.trim() && signed : codeOk;
  const out = outletById.get(o.outlet_id)!;
  const step = st.stage === "delivered" ? 3 : st.arrivedAt ? 2 : 1;
  const unit = o.brand === "Fresh" ? "crates" : "units";

  const save = () => {
    dispatch({
      type: "fieldEvent",
      event: newEvent(o.order_ref, "delivered", { deliveredUnits: units, exception: exc === "none" ? (units < o.order_units - shortAtDock ? "short" : undefined) : exc, pod: useSig ? { name: name.trim(), method: "signature" } : { name: `${o.outlet_id} staff`, method: "code", code } }),
    });
    // Another order at the same stop? Open it next; otherwise back to the run.
    const sameStop = s.orders.find((x) => x.order_ref !== o.order_ref && tripKey(x) === tripKey(o) && x.decision === "served" && x.stop_seq === o.stop_seq && !["delivered", "received"].includes(driverState(s, x.order_ref).stage) && !s.states[x.order_ref].reassignedTo);
    router.push(sameStop ? `/driver/stop/${sameStop.order_ref}` : "/driver");
  };
  const run = s.orders.filter((x) => tripKey(x) === tripKey(o) && x.decision === "served" && !(s.states[x.order_ref].reassignedTo && s.driver.online));
  const seqs = [...new Set(run.map((x) => x.stop_seq))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const here = run.filter((x) => x.stop_seq === o.stop_seq);

  return (
    <Shell role="driver" who={seed.personas.driver.name} right={<SyncChip />}>
      <BtnLink href="/driver" variant="ghost" className="-ml-3">
        <IconBack /> {t("Today's run")}
      </BtnLink>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="font-cond text-4xl font-bold">{o.outlet_id}</h1>
        <OrderMarks o={o} className="size-6" />
        <span className="ml-auto font-cond text-xl text-mute">{t("Stop {a} of {b}", { a: seqs.indexOf(o.stop_seq) + 1, b: seqs.length })}</span>
      </div>
      <p className="text-lg">
        {t("Window {a}–{b}", { a: o.window_open_time, b: o.window_close_time })}
        {out.mall_window ? ` · ${t("mall bay {w}", { w: out.mall_window })}` : ""}
      </p>

      {here.length > 1 && (
        <p className="mt-2 rounded-md bg-amber-soft px-3 py-2 text-sm font-semibold text-hivis-deep">
          {t("This stop has {n} orders. Record each one; the next opens when you save.", { n: here.length })}{" "}
          <span className="font-normal">({here.map((x) => `${t(x.temp_requirement === "chilled" ? "Chilled" : "Dry")} ${x.order_units}`).join(" + ")})</span>
        </p>
      )}
      <ol className="mt-4 flex gap-1.5" aria-label="Steps">
        {["Arrived", "Deliver", "Proof"].map((l, i) => (
          <li key={l} className={`flex-1 rounded-sm py-1 text-center text-sm font-semibold ${i + 1 < step || step === 3 ? "bg-night text-white" : i + 1 === step ? "bg-hivis text-night" : "bg-line text-mute"}`}>
            {i + 1}. {t(l)}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card className="mt-4 p-4">
          <p className="text-lg">{t("Tap when you've parked at the outlet. The time is recorded on this phone.")}</p>
          <Btn variant="primary" size="xl" className="mt-4 w-full" onClick={() => dispatch({ type: "fieldEvent", event: newEvent(o.order_ref, "arrived") })}>
            {t("I've arrived")}
          </Btn>
        </Card>
      )}

      {step === 2 && (
        <Card className="mt-4 space-y-5 p-4">
          <p className="text-mute">{t("Arrived {t}", { t: st.arrivedAt })}</p>
          <div>
            <p className="text-lg font-semibold">
              {t(unit === "crates" ? "How many crates did you hand over?" : "How many units did you hand over?")}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Btn size="xl" onClick={() => setUnits((u) => Math.max(0, u - 1))} aria-label="Fewer">
                −
              </Btn>
              <span className="w-16 text-center font-cond text-4xl font-bold" aria-live="polite">
                {units}
              </span>
              <Btn size="xl" onClick={() => setUnits((u) => Math.min(o.order_units, u + 1))} aria-label="More">
                +
              </Btn>
              <span className="text-lg text-mute">{t("of {n}", { n: o.order_units })}</span>
            </div>
            {shortAtDock > 0 && <p className="mt-2 text-sm font-semibold text-late">{t("{n} crates were short at the dock. The store already knows.", { n: shortAtDock })}</p>}
          </div>
          <div>
            <p className="text-lg font-semibold">{t("Anything wrong?")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["none", "short", "damaged", "refused", "closed"] as Exc[]).map((k) => (
                <Btn key={k} size="lg" variant={exc === k ? "primary" : "secondary"} aria-pressed={exc === k} onClick={() => setExc(k)}>
                  {t({ none: "No, all fine", short: "Short", damaged: "Damaged", refused: "Refused", closed: "Outlet closed" }[k])}
                </Btn>
              ))}
            </div>
          </div>
          {!useSig ? (
            <div>
              <label htmlFor="code" className="flex items-center gap-2 text-lg font-semibold">
                <IconLock className="size-5" /> {t("Handover code")}
              </label>
              <p className="text-sm text-mute">{t("Ask the receiver for the 4-digit code on their WhatsApp message.")}</p>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="• • • •"
                className={`mt-2 h-16 w-full rounded-md border-2 text-center font-cond text-4xl font-bold tracking-[0.5em] ${code.length === 4 ? (codeOk ? "border-ok bg-ok-soft" : "border-late bg-late-soft") : "border-line"}`}
              />
              {code.length === 4 && <p className={`mt-1 text-sm font-semibold ${codeOk ? "text-ok" : "text-late"}`}>{t(codeOk ? "Code matches. Checked on this phone, no signal needed." : "That code doesn't match this order.")}</p>}
              <button onClick={() => setUseSig(true)} className="mt-2 h-11 text-sm font-semibold text-mute underline">
                {t("No code? Take a name and signature instead")}
              </button>
            </div>
          ) : (
          <>
          <button onClick={() => setUseSig(false)} className="h-11 text-sm font-semibold text-mute underline">
            {t("Use the handover code instead")}
          </button>
          <div>
            <label htmlFor="rcv" className="text-lg font-semibold">
              {t("Received by")}
            </label>
            <input id="rcv" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name of the person receiving")} className="mt-2 h-14 w-full rounded-md border border-line px-3 text-lg" autoComplete="off" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">{t("Signature")}</p>
              {signed && (
                <button onClick={() => { setSigned(false); setPadKey((k) => k + 1); }} className="h-11 px-3 text-sm font-semibold text-mute underline">
                  {t("Clear")}
                </button>
              )}
            </div>
            <SignaturePad key={padKey} onSigned={() => setSigned(true)} />
          </div>
          </>
          )}
          <Btn variant="primary" size="xl" className="w-full" disabled={!canSave} onClick={save}>
            <IconCheck className="size-6" /> {t("Save delivery")}
          </Btn>
          {!canSave && <p className="text-center text-sm text-mute">{t(useSig ? "Add the receiver's name and signature to save." : "Enter the store's handover code to save.")}</p>}
        </Card>
      )}

      {step === 3 && (
        <Card className="mt-4 p-4">
          <p className="text-lg font-semibold text-ok">{t("Delivered at {t}", { t: st.deliveredAt })}</p>
          <p className="mt-1">
            {t("{a} of {b}", { a: st.deliveredUnits, b: o.order_units })} {t(unit)} · {st.pod?.method === "code" ? t("verified with the store's handover code") : t("received by {n}", { n: st.pod?.name })}
            {st.exception ? ` · ${t(st.exception)}` : ""}
          </p>
          <p className="mt-2 text-mute">{t(st.pending ? "Saved on this phone. It sends by itself when signal returns." : "Sent. The store can now confirm receipt.")}</p>
          <BtnLink href="/driver" variant="primary" size="lg" className="mt-4 w-full">
            {t("Next stop")}
          </BtnLink>
        </Card>
      )}
    </Shell>
  );
}

function SignaturePad({ onSigned }: { onSigned: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 600, ((e.clientY - r.top) / r.height) * 200] as const;
  };
  return (
    <canvas
      ref={ref}
      width={600}
      height={200}
      aria-label="Signature pad: sign with your finger"
      className="mt-2 h-32 w-full touch-none rounded-md border border-line bg-paper"
      onPointerDown={(e) => {
        drawing.current = true;
        const c = ref.current!.getContext("2d")!;
        c.lineWidth = 3;
        c.lineCap = "round";
        c.strokeStyle = "#16233a";
        c.beginPath();
        c.moveTo(...pos(e));
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const c = ref.current!.getContext("2d")!;
        c.lineTo(...pos(e));
        c.stroke();
        onSigned();
      }}
      onPointerUp={() => (drawing.current = false)}
      onPointerLeave={() => (drawing.current = false)}
    />
  );
}

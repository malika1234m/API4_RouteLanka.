"use client";

import { useParams, useRouter } from "next/navigation";
import { useRef, useState, type PointerEvent } from "react";
import { Shell } from "@/components/Shell";
import { SyncChip } from "@/components/SyncChip";
import { Btn, BtnLink, Card, IconBack, IconCheck, OrderMarks } from "@/components/ui";
import { driverState } from "@/lib/driver";
import { outletById, seed } from "@/lib/seed";
import { newEvent, useDemo } from "@/lib/store";
import type { OrderState } from "@/lib/types";

type Exc = NonNullable<OrderState["exception"]> | "none";

export default function StopFlow() {
  const { ref } = useParams<{ ref: string }>();
  const router = useRouter();
  const { s, dispatch } = useDemo();
  const o = s.orders.find((x) => x.order_ref === ref);
  const st = o ? driverState(s, o.order_ref) : undefined;
  const [units, setUnits] = useState(o?.order_units ?? 0);
  const [exc, setExc] = useState<Exc>("none");
  const [name, setName] = useState("");
  const [signed, setSigned] = useState(false);
  const [padKey, setPadKey] = useState(0);

  if (!o || !st) return <Shell role="driver" who={seed.personas.driver.name}>Stop not found.</Shell>;
  const out = outletById.get(o.outlet_id)!;
  const step = st.stage === "delivered" ? 3 : st.arrivedAt ? 2 : 1;
  const unit = o.brand === "Fresh" ? "crates" : "units";

  const save = () => {
    dispatch({
      type: "fieldEvent",
      event: newEvent(o.order_ref, "delivered", { deliveredUnits: units, exception: exc === "none" ? (units < o.order_units ? "short" : undefined) : exc, pod: { name: name.trim(), method: "signature" } }),
    });
    router.push("/driver");
  };

  return (
    <Shell role="driver" who={seed.personas.driver.name} right={<SyncChip />}>
      <BtnLink href="/driver" variant="ghost" className="-ml-3">
        <IconBack /> Today&apos;s run
      </BtnLink>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="font-cond text-4xl font-bold">{o.outlet_id}</h1>
        <OrderMarks o={o} className="size-6" />
        <span className="ml-auto font-cond text-xl text-mute">Stop {o.stop_seq}</span>
      </div>
      <p className="text-lg">
        Window {o.window_open_time}–{o.window_close_time}
        {out.mall_window ? ` · mall bay ${out.mall_window}` : ""}
      </p>

      <ol className="mt-4 flex gap-1.5" aria-label="Steps">
        {["Arrived", "Deliver", "Proof"].map((l, i) => (
          <li key={l} className={`flex-1 rounded-sm py-1 text-center text-sm font-semibold ${i + 1 < step || step === 3 ? "bg-night text-white" : i + 1 === step ? "bg-hivis text-night" : "bg-line text-mute"}`}>
            {l}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card className="mt-4 p-4">
          <p className="text-lg">Tap when you&apos;ve parked at the outlet. The time is recorded on this phone.</p>
          <Btn variant="primary" size="xl" className="mt-4 w-full" onClick={() => dispatch({ type: "fieldEvent", event: newEvent(o.order_ref, "arrived") })}>
            I&apos;ve arrived
          </Btn>
        </Card>
      )}

      {step === 2 && (
        <Card className="mt-4 space-y-5 p-4">
          <p className="text-mute">Arrived {st.arrivedAt}</p>
          <div>
            <p className="text-lg font-semibold">
              {unit[0].toUpperCase() + unit.slice(1)} handed over
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
              <span className="text-lg text-mute">of {o.order_units}</span>
            </div>
          </div>
          <div>
            <p className="text-lg font-semibold">Anything wrong?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["none", "short", "damaged", "refused", "closed"] as Exc[]).map((k) => (
                <Btn key={k} size="lg" variant={exc === k ? "primary" : "secondary"} aria-pressed={exc === k} onClick={() => setExc(k)}>
                  {{ none: "No, all fine", short: "Short", damaged: "Damaged", refused: "Refused", closed: "Outlet closed" }[k]}
                </Btn>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="rcv" className="text-lg font-semibold">
              Received by
            </label>
            <input id="rcv" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person receiving" className="mt-2 h-14 w-full rounded-md border border-line px-3 text-lg" autoComplete="off" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">Signature</p>
              {signed && (
                <button onClick={() => { setSigned(false); setPadKey((k) => k + 1); }} className="h-11 px-3 text-sm font-semibold text-mute underline">
                  Clear
                </button>
              )}
            </div>
            <SignaturePad key={padKey} onSigned={() => setSigned(true)} />
          </div>
          <Btn variant="primary" size="xl" className="w-full" disabled={!name.trim() || !signed} onClick={save}>
            <IconCheck className="size-6" /> Save delivery
          </Btn>
          {(!name.trim() || !signed) && <p className="text-center text-sm text-mute">Add the receiver&apos;s name and signature to save.</p>}
        </Card>
      )}

      {step === 3 && (
        <Card className="mt-4 p-4">
          <p className="text-lg font-semibold text-ok">Delivered at {st.deliveredAt}</p>
          <p className="mt-1">
            {st.deliveredUnits} of {o.order_units} {unit} · received by {st.pod?.name}
            {st.exception ? ` · ${st.exception}` : ""}
          </p>
          <p className="mt-2 text-mute">{st.pending ? "Saved on this phone. It sends by itself when signal returns." : "Sent. The store can now confirm receipt."}</p>
          <BtnLink href="/driver" variant="primary" size="lg" className="mt-4 w-full">
            Next stop
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

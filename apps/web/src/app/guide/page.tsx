"use client";

import Image from "next/image";
import Link from "next/link";
import { ROLES, Wordmark } from "@/components/Shell";
import { IconArrow, IconCheck, Meter } from "@/components/ui";
import { REASON_LABEL } from "@/lib/seed";
import { loadsFor } from "@/lib/rules";
import { outletById, seed, tripKey } from "@/lib/seed";
import { useDemo, type DemoState } from "@/lib/store";

const DRIVER_KEY = `${seed.personas.driver.vehicle_id}#${seed.personas.driver.trip_id}`;
const vals = (s: DemoState) => Object.values(s.states);

const STEPS: { text: string; who: string; href: string; done: (s: DemoState) => boolean }[] = [
  { text: "Review the proposed plan and publish it", who: "Dispatcher", href: "/dispatch/plan", done: (s) => s.published },
  { text: "Read the deferral on WhatsApp and reply", who: "Store manager", href: "/store/messages?outlet=OUT029", done: (s) => Object.keys(s.acks ?? {}).length > 0 },
  { text: "Flag a missing crate while loading VEH041", who: "Loader", href: `/dock/${seed.personas.driver.vehicle_id}/${seed.personas.driver.trip_id}`, done: (s) => vals(s).some((x) => x.loadFlag) },
  { text: "Decide what happens to the shortfall", who: "Dispatcher", href: "/dispatch/monitor", done: (s) => vals(s).some((x) => x.loadDecision) },
  { text: "Mark VEH041 ready and release it", who: "Loader", href: `/dock/${seed.personas.driver.vehicle_id}/${seed.personas.driver.trip_id}`, done: (s) => !!s.departed[DRIVER_KEY] },
  { text: "Lose signal, deliver OUT108 with the handover code", who: "Driver", href: "/driver", done: (s) => s.driver.outbox.some((e) => e.type === "delivered") || vals(s).some((x) => x.recordedOffline) },
  { text: "Road blocked: report the delay (goes by SMS)", who: "Driver", href: "/driver", done: (s) => !!s.driver.delay },
  { text: "Decide the held-up stops and tell the stores", who: "Dispatcher", href: "/dispatch/map", done: (s) => !!s.delayToldAt },
  { text: "OUT104 answers the delay on WhatsApp", who: "Store manager", href: "/store/messages?outlet=OUT104", done: (s) => Object.keys(s.storeReplies ?? {}).length > 0 },
  { text: "Reconnect and watch the records sync", who: "Driver", href: "/driver", done: (s) => (s.driver.lastSync?.count ?? 0) > 0 },
  { text: "OUT108 confirms receipt or reports an issue", who: "Store manager", href: "/store/messages?outlet=OUT108", done: (s) => vals(s).some((x) => x.receipt) },
  { text: "Fix the fleet: ask the workshop or hire a truck", who: "Dispatcher", href: "/dispatch/fleet", done: (s) => (s.fleet?.repairs.length ?? 0) + (s.fleet?.hires.length ?? 0) > 0 },
];

export default function Home() {
  const { s, dispatch } = useDemo();
  const served = s.orders.filter((o) => o.decision === "served").length;
  const deferred = s.orders.length - served;
  const delivered = vals(s).filter((x) => x.stage === "delivered" || x.stage === "received").length;
  const issues = s.feed.filter((f) => f.open).length;
  const doneCount = STEPS.filter((st) => st.done(s)).length;
  const nextStep = STEPS.find((st) => !st.done(s));

  const status = roleStatus(s);
  const kpis = [
    { label: "Orders closed", value: s.orders.length },
    { label: "Planned", value: served },
    { label: "Deferred", value: deferred, tone: "text-late" },
    { label: "Delivered", value: delivered },
    { label: "Open issues", value: issues, tone: issues ? "text-late" : "" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="bg-night text-white">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="flex items-center gap-5">
            <Image src="/brand/routelanka-logo.jpg" alt="RouteLanka" width={132} height={132} priority className="hidden size-[132px] shrink-0 rounded-2xl ring-1 ring-white/10 sm:block" />
            <div>
            <span className="sm:hidden">
              <Wordmark light />
            </span>
            <h1 className="mt-3 sm:mt-0 max-w-2xl text-balance font-cond text-3xl font-bold leading-tight sm:text-4xl">Every decision reaches the next person in time to act on it.</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/70">
              Friday 24 April 2026 · Vesak is a week away · Peliyagoda and Kandy depots. Chilled demand exceeds the refrigerated fleet tonight.
            </p>
            </div>
          </div>
          <dl className="grid grid-cols-5 gap-px overflow-hidden rounded-lg bg-white/10 text-center">
            {kpis.map((k) => (
              <div key={k.label} className="bg-night-2 px-3 py-2.5 sm:px-4">
                <dt className="text-[11px] text-white/60 sm:text-xs">{k.label}</dt>
                <dd className={`font-cond text-2xl font-bold sm:text-3xl ${k.tone === "text-late" && k.value ? "text-[#ff9b8a]" : ""}`}>{k.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="roles-h">
          <h2 id="roles-h" className="font-cond text-xl font-semibold">
            Open the system as
          </h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {ROLES.map((r, i) => (
              <li key={r.role}>
                <Link href={r.href} className="group flex h-full flex-col rounded-lg border border-line bg-card p-4 transition-colors hover:border-night">
                  <span className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-hivis font-cond text-xl font-bold text-night">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block font-cond text-xl font-semibold leading-tight">{r.label}</span>
                      <span className="block text-sm text-mute">
                        {r.who} · {r.device}
                      </span>
                    </span>
                    <IconArrow className="ml-auto size-5 text-mute transition-transform group-hover:translate-x-0.5 group-hover:text-night" />
                  </span>
                  <span className="mt-3 rounded-md bg-paper px-3 py-2 text-sm">{status[r.role]}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex flex-wrap gap-2 text-sm">
            {["WhatsApp for stores, no app", "Sinhala · Tamil · English", "Handover codes that work offline", "Check-in map, never a fake live dot", "Fleet and hire decisions in rupees"].map((x) => (
              <span key={x} className="rounded-md border border-line bg-card px-2 py-1 font-medium">{x}</span>
            ))}
          </p>
          <p className="mt-3 text-sm text-mute">Demo accounts for each role are on the <Link href="/login" className="underline">sign-in page</Link>. Tip: open two tabs, for example the dispatcher on a laptop and the driver in a phone-sized window (or use <Link href="/preview" className="underline">/preview</Link>). Every action appears in the other tab straight away.</p>
          <Tonight />
        </section>

        <aside aria-labelledby="walk-h" className="rounded-lg border border-line bg-card">
          <div className="border-b border-line p-4">
            <div className="flex items-baseline justify-between">
              <h2 id="walk-h" className="font-cond text-xl font-semibold">
                Walkthrough
              </h2>
              <span className="font-cond text-lg font-semibold">
                {doneCount}/{STEPS.length}
              </span>
            </div>
            <div className="mt-2 flex gap-[3px]" aria-hidden>
              {STEPS.map((st, i) => (
                <span key={i} className={`h-2 flex-1 rounded-[2px] ${st.done(s) ? "bg-night" : st === nextStep ? "bg-hivis" : "bg-line"}`} />
              ))}
            </div>
          </div>
          <ol className="divide-y divide-line">
            {STEPS.map((st, i) => {
              const done = st.done(s);
              const isNext = st === nextStep;
              return (
                <li key={st.text}>
                  <Link href={st.href} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-paper ${isNext ? "bg-amber-soft" : ""}`}>
                    <span className={`grid size-7 shrink-0 place-items-center rounded-md font-cond text-sm font-bold ${done ? "bg-ok text-white" : isNext ? "bg-hivis text-night" : "bg-paper text-mute"}`}>{done ? <IconCheck className="size-4" /> : i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${done ? "text-mute line-through decoration-mute/40" : "font-medium"}`}>{st.text}</span>
                      <span className="text-xs text-mute">{st.who}</span>
                    </span>
                    {isNext && <span className="text-xs font-semibold text-hivis-deep">Next</span>}
                  </Link>
                </li>
              );
            })}
          </ol>
          <div className="border-t border-line p-3">
            <button onClick={() => dispatch({ type: "reset" })} className="h-9 w-full rounded-md border border-line text-sm font-semibold hover:border-night">
              Reset demo day
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

function roleStatus(s: DemoState): Record<string, string> {
  const outlet = outletById.get(seed.personas.store.outlet_id)!;
  const mine = s.orders.filter((o) => o.outlet_id === outlet.outlet_id);
  const myDeferred = mine.filter((o) => o.decision === "deferred").length;
  const kandyTrips = seed.vehicles.filter((v) => v.depot === seed.personas.loader.depot).flatMap((v) => loadsFor(v, s.orders));
  const ready = kandyTrips.filter((l) => s.ready[tripKey(l)] || s.departed[tripKey(l)]).length;
  const stops = s.orders.filter((o) => tripKey(o) === DRIVER_KEY && o.decision === "served" && !s.states[o.order_ref].reassignedTo);
  const done = stops.filter((o) => ["delivered", "received"].includes(s.states[o.order_ref].stage) || s.driver.outbox.some((e) => e.order_ref === o.order_ref && e.type === "delivered")).length;
  const deferredAll = s.orders.filter((o) => o.decision === "deferred").length;
  return {
    store: s.published ? `${outlet.outlet_id} ${outlet.district}: ${mine.length - myDeferred} planned, ${myDeferred} deferred with a reason` : `${outlet.outlet_id} ${outlet.district}: ${mine.length} orders confirmed, waiting for the plan`,
    dispatcher: s.published ? `Plan v${s.planVersion} published · ${s.feed.filter((f) => f.open).length} decisions waiting` : `${s.orders.length} orders · ${deferredAll} won't fit · plan ready to review`,
    loader: s.published ? `${seed.personas.loader.depot} dock: ${ready} of ${kandyTrips.length} trips ready` : "Waiting for the dispatcher to publish",
    driver: !s.published ? `${seed.personas.driver.vehicle_id}: run not published yet` : `${seed.personas.driver.vehicle_id}: ${done} of ${stops.length} deliveries done · ${s.driver.online ? "online" : "no signal"}`,
  };
}

/** Why tonight is hard, in three facts, plus a door into the failure scenario. */
function Tonight() {
  const { s } = useDemo();
  const depot = "Peliyagoda";
  const avail = seed.vehicles.filter((v) => v.depot === depot && v.status === "available");
  const reefers = avail.filter((v) => v.temp === "reefer");
  const workshop = seed.vehicles.filter((v) => v.depot === depot && v.status !== "available");
  const chilled = s.orders.filter((o) => o.depot === depot && o.temp_requirement === "chilled").reduce((a, o) => a + o.order_volume_m3, 0);
  const reeferCap = reefers.reduce((a, v) => a + v.volume_cap_m3, 0) * 2;
  const deferred = s.orders.filter((o) => o.decision === "deferred");
  const reasons = Object.entries(deferred.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.reason ?? "dispatcher_choice"]: (acc[o.reason ?? "dispatcher_choice"] ?? 0) + 1 }), {}));
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-line bg-card p-4 sm:col-span-3">
        <h2 className="font-cond text-xl font-semibold">Tonight at Peliyagoda</h2>
        <p className="mt-1 text-sm text-mute">
          {workshop.length} vehicles are in the workshop, including {workshop.filter((v) => v.temp === "reefer").length} refrigerated trucks. Only {reefers.length} refrigerated vehicles are left for the festival build-up.
        </p>
        <div className="mt-3">
          <Meter big label="Chilled demand vs refrigerated capacity (all refrigerated vehicles, two trips each)" used={chilled} cap={reeferCap} unit="m³" />
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {reasons.map(([r, n]) => (
            <li key={r} className="flex justify-between gap-3">
              <span>{REASON_LABEL[r]}</span>
              <span className="font-cond font-semibold text-late">
                {n} deferred
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Link href="/dispatch/plan" className="group rounded-lg border border-line bg-card p-4 transition-colors hover:border-night">
        <span className="font-cond text-lg font-semibold">Why was it deferred?</span>
        <span className="mt-1 block text-sm text-mute">On the plan board, select any deferred order to see every valid move, or the rule that makes the deferral unavoidable.</span>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
          Open the plan board <IconArrow className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
      <Link href="/driver" className="group rounded-lg border border-hivis bg-amber-soft p-4 transition-colors hover:border-night">
        <span className="font-cond text-lg font-semibold">The failure we designed for</span>
        <span className="mt-1 block text-sm text-hivis-deep">Dark Stretch: the driver loses signal on the Nuwara Eliya hill road, where 37% of deliveries are already late.</span>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
          Open the driver’s run <IconArrow className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
      <Link href="/dispatch/fleet" className="group rounded-lg border border-line bg-card p-4 transition-colors hover:border-night">
        <span className="font-cond text-lg font-semibold">Fix the fleet before Vesak</span>
        <span className="mt-1 block text-sm text-mute">Which workshop trucks to repair first, and when hiring a refrigerated truck costs less than deferring.</span>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold">
          Open fleet readiness <IconArrow className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </div>
  );
}

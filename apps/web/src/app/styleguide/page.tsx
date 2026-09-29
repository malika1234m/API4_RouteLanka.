import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Shell";
import { Btn, Chip, IconChill, IconMall, IconNoSignal, IconOutbox, IconSignal, IconVan, IconCheck, IconFlag, Meter, RelayTrack } from "@/components/ui";

export const metadata = { title: "Style guide · RouteLanka" };

const COLORS = [
  { name: "night", hex: "#16233A", role: "Structure: header, primary text, loaded state", text: "white" },
  { name: "paper", hex: "#EEF1F4", role: "Page background", text: "night" },
  { name: "card", hex: "#FFFFFF", role: "Surfaces", text: "night" },
  { name: "line", hex: "#D5DBE3", role: "Borders, planned state", text: "night" },
  { name: "mute", hex: "#5D6B7E", role: "Secondary text (4.8:1 on paper)", text: "white" },
  { name: "hivis", hex: "#F5B800", role: "The one accent: primary actions, hand-offs, next step", text: "night" },
  { name: "chill", hex: "#16639A", role: "Chilled goods and refrigerated vehicles only", text: "white" },
  { name: "ok", hex: "#23703C", role: "Delivered, received, within capacity", text: "white" },
  { name: "late", hex: "#A8301F", role: "Deferred, late, issues, rule breaks", text: "white" },
];

const TYPE = [
  { cls: "font-cond text-4xl font-bold", label: "Barlow Condensed Bold 36", sample: "Every decision reaches the next person" },
  { cls: "font-cond text-2xl font-bold", label: "Barlow Condensed Bold 24: page titles, figures", sample: "Plan board · 74 served" },
  { cls: "font-cond text-xl font-semibold", label: "Barlow Condensed Semibold 20: vehicle and outlet IDs", sample: "VEH041 · OUT107" },
  { cls: "text-base", label: "Barlow Regular 16: body", sample: "Not coming on Friday's run. Moved to Saturday 25 April." },
  { cls: "text-sm", label: "Barlow Regular 14: tables, secondary", sample: "05:30–08:00 · rear dock · 36 crates" },
  { cls: "text-xs text-mute", label: "Barlow Regular 12: labels (minimum size)", sample: "Refrigerated load" },
];

function Section({ n, title, intro, children }: { n: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-8">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <div>
          <p className="font-cond text-sm font-semibold text-mute">{n}</p>
          <h2 className="font-cond text-2xl font-bold">{title}</h2>
          <p className="mt-2 text-sm text-mute">{intro}</p>
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

export default function StyleGuide() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-night text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-6">
          <Image src="/brand/routelanka-logo.jpg" alt="RouteLanka" width={88} height={88} priority className="size-[88px] rounded-xl ring-1 ring-white/10" />
          <div>
            <h1 className="font-cond text-3xl font-bold">RouteLanka style guide</h1>
            <p className="text-sm text-white/70">One visual language for four people working in very different conditions: an office screen, a cold dock, a moving truck and a shop counter.</p>
          </div>
          <Link href="/" className="ml-auto text-sm text-white/70 underline hover:text-white">
            Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        <Section n="01" title="Principles" intro="Every choice traces back to the operation, not to fashion.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ["Honest over reassuring", "Unknown is shown as unknown (hatched), never as \"on time\". Demonstrated capacity, not theoretical."],
              ["Consequences, not codes", "\"No chilled delivery tomorrow morning\", not reefer_capacity."],
              ["One accent", "Hi-vis yellow marks the next action and every hand-off. Nothing else competes with it."],
              ["Built for the worst context", "Gloves at the dock, a phone on a hill road with no signal, a dispatcher at 4 PM."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-lg border border-line bg-card p-4">
                <p className="font-semibold">{t}</p>
                <p className="mt-1 text-sm text-mute">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section n="02" title="Logo and icon" intro="The truck on a winding road into the island, with a pin at the destination. The symbol alone is the app icon; the full logo appears where there is room for the name.">
          <div className="flex flex-wrap items-end gap-6">
            <figure>
              <Image src="/brand/routelanka-logo.jpg" alt="Full logo" width={160} height={160} loading="eager" className="size-40 rounded-xl" />
              <figcaption className="mt-2 text-xs text-mute">Full logo: home, README, splash</figcaption>
            </figure>
            <figure>
              <Image src="/brand/routelanka-mark.png" alt="App icon" width={96} height={96} loading="eager" className="size-24 rounded-2xl" />
              <figcaption className="mt-2 text-xs text-mute">App icon: tab, home screen</figcaption>
            </figure>
            <figure>
              <div className="flex gap-3 rounded-lg bg-night p-3">
                {[48, 32, 16].map((s) => (
                  <Image key={s} src="/brand/routelanka-mark.png" alt="" width={s} height={s} loading="eager" style={{ width: s, height: s }} className="rounded" />
                ))}
              </div>
              <figcaption className="mt-2 text-xs text-mute">Small sizes: 48 / 32 / 16 px</figcaption>
            </figure>
            <figure>
              <div className="rounded-lg bg-night px-4 py-3">
                <Wordmark light />
              </div>
              <figcaption className="mt-2 text-xs text-mute">Header lockup</figcaption>
            </figure>
          </div>
        </Section>

        <Section n="03" title="Colour" intro="Named after where they come from: the night-shift office, the dock's safety paint, the cold chain. Status text meets WCAG AA (4.5:1) on its tinted chip.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {COLORS.map((c) => (
              <div key={c.name} className="overflow-hidden rounded-lg border border-line bg-card">
                <div className="flex h-16 items-end p-2 font-cond text-lg font-bold" style={{ background: c.hex, color: c.text === "white" ? "#fff" : "#16233a" }}>
                  {c.name}
                </div>
                <div className="p-2 text-xs">
                  <p className="font-cond text-sm font-semibold">{c.hex}</p>
                  <p className="text-mute">{c.role}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-2">
              <span className="hatch h-4 w-12 rounded-sm" /> Dock tape: signal lost, state unknown
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="hatch-soft h-4 w-12 rounded-sm border border-hivis" /> Soft tape: waiting to sync
            </span>
          </div>
        </Section>

        <Section n="04" title="Type" intro="Barlow is modelled on road-sign lettering, which suits a delivery network. The condensed cut carries IDs, times and figures, which are dense and must fit. Numbers are tabular so columns line up.">
          <div className="space-y-3">
            {TYPE.map((t) => (
              <div key={t.label} className="flex flex-col gap-1 border-b border-line/60 pb-3 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="w-72 shrink-0 text-xs text-mute">{t.label}</span>
                <span className={t.cls}>{t.sample}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section n="05" title="The relay track" intro="The signature element. The same bar, in the same place, for every role, so everyone reads an order's state the same way.">
          <div className="space-y-5 rounded-lg border border-line bg-card p-4">
            {[
              { label: "Planned", st: { stage: "planned" as const, deferred: false } },
              { label: "On road", st: { stage: "on_road" as const, deferred: false } },
              { label: "Deferred", st: { stage: "ordered" as const, deferred: true } },
              { label: "Flagged at the dock", st: { stage: "loaded" as const, deferred: false, loadFlag: { kind: "missing" as const, qty: 2 } } },
              { label: "On road, driver offline (next step unknown)", st: { stage: "on_road" as const, deferred: false }, pending: true },
              { label: "Received", st: { stage: "received" as const, deferred: false, receipt: { ok: true } } },
            ].map((x) => (
              <div key={x.label}>
                <p className="mb-1 text-sm font-semibold">{x.label}</p>
                <RelayTrack st={x.st} pending={x.pending} />
              </div>
            ))}
          </div>
        </Section>

        <Section n="06" title="Status and markers" intro="Colour is never the only signal: every status has a word and every marker has an icon and a label.">
          <div className="flex flex-wrap gap-2">
            <Chip>Planned</Chip>
            <Chip tone="night">On road</Chip>
            <Chip tone="ok">Delivered 05:48</Chip>
            <Chip tone="late">Deferred</Chip>
            <Chip tone="late">Likely late 87%</Chip>
            <Chip tone="hivis">3 days unserved</Chip>
            <Chip tone="chill">Refrigerated truck</Chip>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [<span key="c" className="text-chill"><IconChill className="size-5" /></span>, "Chilled"],
              [<IconVan key="v" className="size-5" />, "Van-only outlet"],
              [<IconMall key="m" className="size-5" />, "Mall window"],
              [<IconFlag key="f" className="size-5" />, "Flag a problem"],
              [<IconCheck key="k" className="size-5" />, "Done"],
              [<IconOutbox key="o" className="size-5" />, "Saved, will send"],
              [<IconSignal key="s" className="size-5" />, "In contact"],
              [<IconNoSignal key="n" className="size-5" />, "No signal"],
            ].map(([icon, label]) => (
              <span key={String(label)} className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2">
                {icon}
                {label}
              </span>
            ))}
          </div>
        </Section>

        <Section n="07" title="Controls and density" intro="Desktop screens are dense for the dispatcher. Phone and tablet screens use 44 px minimum targets for drivers and loaders, who may be wearing gloves.">
          <div className="flex flex-wrap items-center gap-3">
            <Btn variant="primary">Publish plan</Btn>
            <Btn>Secondary</Btn>
            <Btn variant="danger">Defer</Btn>
            <Btn variant="ghost">Ghost</Btn>
            <Btn disabled>Disabled</Btn>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Btn variant="primary" size="lg">
              Dock tablet · 48 px
            </Btn>
            <Btn variant="primary" size="xl">
              Driver phone · 64 px
            </Btn>
          </div>
          <div className="mt-5 grid max-w-xl gap-4 sm:grid-cols-2">
            <Meter label="Fresh window" used={176} cap={270} unit="min" />
            <Meter label="Near limit (over 90%)" used={250} cap={270} unit="min" />
            <Meter label="Over capacity" used={182} cap={172} unit="m³" />
            <Meter label="Fuel left this week" used={33} cap={213} unit="L" />
          </div>
        </Section>

        <Section n="08" title="Voice" intro="Plain, active, sentence case. Name things the way the person doing the job would.">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Instead of", "Write", true],
              ["reefer_capacity", "Refrigerated capacity full", false],
              ["Sync pending (3)", "3 saved on phone, will send when signal returns", false],
              ["Error: constraint violation", "Trip 2 mixes districts (one district per trip)", false],
              ["Order status: DEFERRED", "Not coming on Friday's run. Moved to Saturday, and you're first in line.", false],
            ].map(([a, b, head]) => (
              <div key={String(a)} className={`contents ${head ? "text-xs font-semibold text-mute" : "text-sm"}`}>
                <span className={head ? "" : "rounded-md bg-late-soft px-3 py-2 text-late line-through decoration-late/40"}>{a}</span>
                <span className={head ? "" : "rounded-md bg-ok-soft px-3 py-2 text-ok"}>{b}</span>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}

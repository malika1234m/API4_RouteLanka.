import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { STAGES, type OrderState, type Stage } from "@/lib/types";

const STAGE_LABEL: Record<Stage, string> = {
  ordered: "Ordered",
  planned: "Planned",
  loaded: "Loaded",
  on_road: "On road",
  delivered: "Delivered",
  received: "Received",
};

/** The signature element: where an order is in the relay, identical for every role. */
type Tr = (k: string) => string;
const same: Tr = (k) => k;

/** Renders **bold** markers in translated sentences. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}
    </>
  );
}

export function RelayTrack({ st, pending = false, compact = false, t = same }: { st?: OrderState; pending?: boolean; compact?: boolean; t?: Tr }) {
  const idx = st ? STAGES.indexOf(st.stage) : 0;
  const issue = !!(st?.loadFlag && !st.loadDecision) || !!st?.receipt?.issue || !!st?.exception;
  return (
    <div className="w-full" aria-label={`Status: ${st?.deferred ? t("Deferred") : t(STAGE_LABEL[st?.stage ?? "ordered"])}`}>
      <div className="flex gap-[3px]">
        {STAGES.map((s, i) => {
          let cls = "bg-line";
          if (st?.deferred && i === 1) cls = "bg-late";
          else if (!st?.deferred && i <= idx) cls = issue && i === idx ? "bg-late" : i === idx ? "rl-fill-warn shadow-[0_0_10px_rgb(245_184_0/0.7)]" : "rl-fill";
          else if (pending && i === idx + 1) cls = "hatch";
          return <span key={s} className={`${compact ? "h-1.5" : "h-2"} flex-1 rounded-full ${cls}`} />;
        })}
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-xs text-mute">
          {STAGES.map((s, i) => (
            <span key={s} className={i === idx && !st?.deferred ? "font-semibold text-night" : st?.deferred && i === 1 ? "font-semibold text-late" : ""}>
              {st?.deferred && i === 1 ? t("Deferred") : t(STAGE_LABEL[s])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type Tone = "neutral" | "ok" | "late" | "chill" | "hivis" | "night";
const TONE: Record<Tone, string> = {
  neutral: "bg-paper text-night border-line",
  ok: "bg-ok-soft text-ok border-ok/30",
  late: "bg-late-soft text-late border-late/30",
  chill: "bg-chill-soft text-chill border-chill/30",
  hivis: "bg-amber-soft text-hivis-deep border-hivis/50",
  night: "bg-night text-white border-night",
};

export function Chip({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}>{children}</span>;
}

export function stageChip(st?: OrderState, t: Tr = same) {
  if (!st) return null;
  if (st.deferred) return <Chip tone="late">{t("Deferred")}</Chip>;
  if (st.deferredEnRoute) return <Chip tone="late">{t("Bring back to depot")}</Chip>;
  if (st.receipt?.issue) return <Chip tone="late">{t("Issue reported")}</Chip>;
  if (st.loadFlag && !st.loadDecision) return <Chip tone="late">{t("Flagged at dock")}</Chip>;
  const tone: Tone = st.stage === "received" || st.stage === "delivered" ? "ok" : st.stage === "on_road" ? "night" : "neutral";
  return <Chip tone={tone}>{t(STAGE_LABEL[st.stage])}</Chip>;
}

/** Used vs capacity. Turns red past 100%, amber past 90%. */
export function Meter({ label, used, cap, unit, big = false }: { label: string; used: number; cap: number; unit: string; big?: boolean }) {
  const pct = cap ? used / cap : 0;
  const color = pct > 1 ? "rl-fill-late" : pct > 0.9 ? "rl-fill-warn" : "rl-fill";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-mute">{label}</span>
        <span className={`font-cond ${big ? "text-base" : "text-sm"} font-semibold ${pct > 1 ? "text-late" : ""}`}>
          {fmtNum(used)}
          <span className="text-mute font-normal"> / {fmtNum(cap)} {unit}</span>
        </span>
      </div>
      <div className={`rl-track mt-1 ${big ? "h-2.5" : "h-1.5"}`}>
        <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${color}`} style={{ width: `${Math.min(pct, 1) * 100}%` }} />
      </div>
    </div>
  );
}

const fmtNum = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1).replace(/\.0$/, ""));

type BtnProps = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "md" | "lg" | "xl" };
export function Btn({ variant = "secondary", size = "md", className = "", ...p }: BtnProps) {
  const v = {
    primary: "rl-primary text-night border-hivis",
    secondary: "bg-card text-night border-line shadow-sm hover:border-night/60 hover:shadow",
    danger: "bg-card text-late border-late/40 hover:bg-late-soft",
    ghost: "bg-transparent text-night border-transparent hover:bg-night/5",
  }[variant];
  const s = { md: "h-9 px-3 text-sm", lg: "h-12 px-4 text-base", xl: "h-16 px-5 text-lg" }[size];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none ${v} ${s} ${className}`} />;
}

export function BtnLink({ href, variant = "secondary", size = "md", className = "", children }: { href: string; variant?: BtnProps["variant"]; size?: BtnProps["size"]; className?: string; children: ReactNode }) {
  const v = { primary: "rl-primary text-night border-hivis", secondary: "bg-card text-night border-line shadow-sm hover:border-night/60 hover:shadow", danger: "bg-card text-late border-late/40", ghost: "text-night border-transparent hover:bg-night/5" }[variant];
  const s = { md: "h-9 px-3 text-sm", lg: "h-12 px-4 text-base", xl: "h-16 px-5 text-lg" }[size];
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-all ${v} ${s} ${className}`}>
      {children}
    </Link>
  );
}

/* ---- icons (inline, 1.75 stroke) ---- */
const I = ({ d, className = "size-4", title }: { d: ReactNode; className?: string; title?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={!title} role={title ? "img" : undefined}>
    {title && <title>{title}</title>}
    {d}
  </svg>
);
export const IconChill = (p: { className?: string }) => <I {...p} title="Chilled" d={<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5" />} />;
export const IconVan = (p: { className?: string }) => <I {...p} title="Van only" d={<><path d="M2 16V7h11l4 4h5v5h-2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M9 17h6" /></>} />;
export const IconMall = (p: { className?: string }) => <I {...p} title="Mall window" d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />;
export const IconSignal = (p: { className?: string }) => <I {...p} d={<path d="M4 20v-3M9 20v-7M14 20V9M19 20V5" />} />;
export const IconNoSignal = (p: { className?: string }) => <I {...p} d={<><path d="M4 20v-3M9 20v-7M14 20v-4" /><path d="M16 4l6 6M22 4l-6 6" /></>} />;
export const IconCheck = (p: { className?: string }) => <I {...p} d={<path d="M4 12.5l5 5L20 6.5" />} />;
export const IconFlag = (p: { className?: string }) => <I {...p} d={<path d="M5 21V4h11l-2 4 2 4H5" />} />;
export const IconOutbox = (p: { className?: string }) => <I {...p} d={<><path d="M4 14v5h16v-5" /><path d="M12 15V3M8 7l4-4 4 4" /></>} />;
export const IconArrow = (p: { className?: string }) => <I {...p} d={<path d="M5 12h14M13 6l6 6-6 6" />} />;
export const IconMap = (p: { className?: string }) => <I {...p} d={<><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>} />;
export const IconChat = (p: { className?: string }) => <I {...p} d={<path d="M4 20l1.5-4A8 8 0 1112 20a8 8 0 01-3.5-.8z" />} />;
export const IconLock = (p: { className?: string }) => <I {...p} d={<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>} />;
export const IconWrench = (p: { className?: string }) => <I {...p} d={<path d="M14.5 6.5a4 4 0 00-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 005.2-5.2l-2.5 2.5-2.5-.5-.5-2.5z" />} />;
export const IconBack = (p: { className?: string }) => <I {...p} d={<path d="M19 12H5M11 6l-6 6 6 6" />} />;

export function OrderMarks({ o, className = "size-4" }: { o: { temp_requirement: string; parking_constraint: string; mall_window?: string } ; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {o.temp_requirement === "chilled" && <span className="text-chill"><IconChill className={className} /></span>}
      {o.parking_constraint === "van_only" && <IconVan className={className} />}
      {o.parking_constraint === "mall_dock" && <IconMall className={className} />}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rl-card rounded-xl border border-line/80 bg-card ${className}`}>{children}</div>;
}

/** A waiting or empty screen: icon in a soft ring, a title and one line of what happens next. */
export function EmptyState({ icon, title, children, className = "" }: { icon: ReactNode; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Card className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      <span className="grid size-16 place-items-center rounded-2xl bg-amber-soft text-hivis-deep ring-8 ring-hivis/10">
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {icon}
        </svg>
      </span>
      <p className="mt-4 font-cond text-2xl font-bold leading-tight">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-sm text-mute">{children}</p>}
    </Card>
  );
}

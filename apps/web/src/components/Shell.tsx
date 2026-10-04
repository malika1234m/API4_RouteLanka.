"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { seed } from "@/lib/seed";
import { demoNow, useDemo, type FeedItem, type Role } from "@/lib/store";
import { LANGS, useT } from "@/lib/i18n";

const NAV: Record<Role, { href: string; label: string }[]> = {
  dispatcher: [
    { href: "/dispatch", label: "Order queue" },
    { href: "/dispatch/plan", label: "Plan board" },
    { href: "/dispatch/monitor", label: "Live runs" },
    { href: "/dispatch/map", label: "Map" },
    { href: "/dispatch/fleet", label: "Fleet" },
    { href: "/dispatch/outlook", label: "Capacity outlook" },
    { href: "/dispatch/whatsapp", label: "WhatsApp" },
    { href: "/dispatch/team", label: "Team" },
  ],
  loader: [{ href: "/dock", label: "Dock queue" }],
  driver: [{ href: "/driver", label: "Today's run" }],
  store: [
    { href: "/store", label: "My deliveries" },
    { href: "/store/order", label: "Place order" },
    { href: "/store/messages", label: "Messages" },
  ],
};

/** The four roles. `who` is the person signed in for that role on this browser (the demo persona until then). */
export const ROLES: { role: Role; label: string; href: string; who: string; device: string }[] = [
  { role: "store", label: "Store manager", href: "/store", get who() { return seed.personas.store.name; }, device: "Desktop / phone" },
  { role: "dispatcher", label: "Dispatcher", href: "/dispatch", get who() { return seed.personas.dispatcher.name; }, device: "Large screen" },
  { role: "loader", label: "Loader", href: "/dock", get who() { return seed.personas.loader.name; }, device: "Dock tablet" },
  { role: "driver", label: "Driver", href: "/driver", get who() { return seed.personas.driver.name; }, device: "Phone" },
];

const WIDTH = { narrow: "max-w-3xl", medium: "max-w-6xl", wide: "max-w-[1440px]" };

export function Wordmark({ light = false, mark = true, compact = false }: { light?: boolean; mark?: boolean; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap font-cond text-lg font-bold leading-none ${light ? "text-white" : "text-night"}`}>
      {mark && <Image src="/brand/routelanka-mark.png" alt="" width={28} height={28} className="size-7 rounded-md" priority />}
      <span className={compact ? "hidden sm:inline" : ""}>
      Route<span className="ml-0.5 inline-block rounded-sm bg-hivis px-1 text-night">Lanka</span>
      </span>
    </span>
  );
}

const subscribeClock = (cb: () => void) => {
  const t = setInterval(cb, 4000); // one demo minute
  return () => clearInterval(t);
};

/** The night being run, e.g. "Sat 20 Dec". */
function NightDate() {
  const { s } = useDemo();
  const d = new Date(`${s.day.service_date}T00:00:00Z`);
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
  return <span className="hidden text-sm text-white/60 lg:inline">{label}</span>;
}

function DemoClock() {
  const { s } = useDemo();
  const t = useSyncExternalStore(subscribeClock, () => demoNow(s.clockStart), () => "03:00");
  return (
    <span className="font-cond text-base text-white" aria-label={`Demo time ${t}`}>
      {t}
    </span>
  );
}

/** Field roles choose Sinhala, Tamil or English. The choice follows the person, not the device. */
function LangSwitch({ role }: { role: Role }) {
  const { s, dispatch } = useDemo();
  const cur = s.lang?.[role] ?? "en";
  const i = LANGS.findIndex((l) => l.id === cur);
  const nextLang = LANGS[(i + 1) % LANGS.length];
  // One change at a time: a second tap before the first is saved would send the same language again.
  const [busy, setBusy] = useState(false);
  const change = async (lang: (typeof LANGS)[number]["id"]) => {
    if (busy) return;
    setBusy(true);
    try {
      await dispatch({ type: "setLang", role, lang });
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
    <button onClick={() => void change(nextLang.id)} disabled={busy} aria-busy={busy} aria-label={`Language: ${LANGS[i].name}. Switch to ${nextLang.name}`} className="h-8 rounded-md bg-white/10 px-2 text-xs font-semibold text-white sm:hidden">
      {LANGS[i].short}
    </button>
    <div role="radiogroup" aria-label="Language" className="hidden rounded-md bg-white/10 p-0.5 sm:flex">
      {LANGS.map((l) => (
        <button key={l.id} role="radio" aria-checked={cur === l.id} title={l.name} onClick={() => void change(l.id)} disabled={busy} className={`h-7 rounded px-1.5 text-xs font-semibold ${cur === l.id ? "bg-hivis text-night" : "text-white/75 hover:text-white"}`}>
          {l.short}
        </button>
      ))}
    </div>
    </>
  );
}

function RoleSwitcher({ role }: { role: Role }) {
  const { t } = useT(role);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const cur = ROLES.find((r) => r.role === role)!;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-white/10">
        <span className="max-w-[34vw] truncate whitespace-nowrap font-semibold text-white sm:max-w-none">{t(cur.label)}</span>
        <span className="hidden text-white/60 md:inline">{cur.who}</span>
        <svg viewBox="0 0 20 20" className="size-4 text-white/60" fill="currentColor" aria-hidden>
          <path d="M5.5 7.5l4.5 5 4.5-5z" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="toast-in absolute left-0 top-10 z-40 w-64 overflow-hidden rounded-lg border border-line bg-card text-night shadow-lg">
          <p className="px-3 pt-2 text-xs text-mute">{t("Switch role")}</p>
          {ROLES.map((r) => (
            <Link key={r.role} role="menuitem" href={r.href} onClick={() => setOpen(false)} className={`flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-paper ${r.role === role ? "bg-amber-soft" : ""}`}>
              <span>
                <span className="block font-semibold">{r.label}</span>
                <span className="block text-xs text-mute">
                  {r.who} · {r.device}
                </span>
              </span>
              {r.role === role && <span className="text-xs font-semibold text-hivis-deep">{t("Current")}</span>}
            </Link>
          ))}
          <button
            onClick={async () => {
              setOpen(false);
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="block w-full border-t border-line px-3 py-2 text-left text-sm text-mute hover:bg-paper"
          >
            {t("Sign out")}
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityBell() {
  const { s } = useDemo();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const openIssues = s.feed.filter((f) => f.open).length;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Activity, ${openIssues} open issues`} className="relative grid size-9 place-items-center rounded-md text-white hover:bg-white/10">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20a2 2 0 004 0" strokeLinejoin="round" />
        </svg>
        {openIssues > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-late px-1 text-[11px] font-bold text-white">{openIssues}</span>}
      </button>
      {open && (
        <div className="toast-in absolute right-0 top-10 z-40 w-80 overflow-hidden rounded-lg border border-line bg-card text-night shadow-lg">
          <p className="border-b border-line px-3 py-2 text-sm font-semibold">Activity across roles</p>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {s.feed.length === 0 && <li className="px-3 py-4 text-sm text-mute">Nothing yet. Publish the plan to start the relay.</li>}
            {s.feed.slice(0, 12).map((f) => (
              <li key={f.id} className="flex gap-2 px-3 py-2 text-sm">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${f.open ? "bg-late" : f.kind === "sync" ? "bg-hivis" : "bg-ok"}`} aria-hidden />
                <span className="min-w-0">
                  <span className="block">{f.text}</span>
                  <span className="text-xs text-mute">
                    {f.at} · {ROLES.find((r) => r.role === f.role)?.label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Link href="/dispatch/monitor" className="block border-t border-line px-3 py-2 text-sm font-semibold hover:bg-paper">
            Open live runs
          </Link>
        </div>
      )}
    </div>
  );
}

/** Shows each new relay event briefly, so every action and hand-off is confirmed. */
function Toaster() {
  const { s } = useDemo();
  const [shown, setShown] = useState<FeedItem | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const latest = s.feed[0];
  if (latest && latest.id !== seen) {
    setSeen(latest.id);
    if (seen !== null) setShown(latest);
  }
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 4500);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4 sm:justify-end">
      {shown && (
        <div key={shown.id} className={`toast-in pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border-l-4 bg-night px-4 py-3 text-sm text-white shadow-lg ${shown.open ? "border-late" : shown.kind === "sync" ? "border-hivis" : "border-ok"}`}>
          <span>
            <span className="block text-xs text-white/60">
              {shown.at} · {ROLES.find((r) => r.role === shown.role)?.label}
            </span>
            {shown.text}
          </span>
          <button onClick={() => setShown(null)} className="ml-2 text-white/60 hover:text-white" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({
  role,
  children,
  width = "narrow",
  right,
}: {
  role: Role;
  who?: string;
  children: ReactNode;
  width?: keyof typeof WIDTH;
  right?: ReactNode;
}) {
  const path = usePathname();
  const w = WIDTH[width];
  const { t } = useT(role);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 bg-night text-white shadow-[0_1px_0_#ffffff14]">
        <div className={`mx-auto flex h-12 items-center gap-2 px-4 ${w}`}>
          <Link href={ROLES.find((r) => r.role === role)?.href ?? "/"} aria-label="RouteLanka home" className="mr-1 shrink-0">
            <Wordmark light compact />
          </Link>
          <RoleSwitcher role={role} />
          <span className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {right}
            {role !== "dispatcher" && <LangSwitch role={role} />}
            <NightDate />
            <DemoClock />
            {/* The driver works stop by stop; the cross-role activity feed only on wider screens. */}
            <span className={role === "driver" ? "hidden sm:block" : ""}>
              <ActivityBell />
            </span>
          </span>
        </div>
        {NAV[role].length > 1 && (
          <nav className={`mx-auto flex gap-1 overflow-x-auto px-3 ${w}`} aria-label="Sections">
            {NAV[role].map((n) => {
              const active = path === n.href;
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`whitespace-nowrap border-b-[3px] px-3 py-2.5 text-sm font-medium ${active ? "border-hivis text-white" : "border-transparent text-white/65 hover:text-white"}`}>
                  {t(n.label)}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main id="main" className={`mx-auto px-4 py-4 ${w}`}>
        {children}
      </main>
      {/* The driver's phone has its own banners; other roles' notices would only distract on the road. */}
      {role !== "driver" && <Toaster />}
    </div>
  );
}

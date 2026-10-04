"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { IslandMap } from "@/components/IslandMap";
import { NightPicker } from "@/components/NightPicker";
import { ROLES } from "@/components/Shell";
import { Btn, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { seed } from "@/lib/seed";
import { useDemo } from "@/lib/store";

/** Seeded demo accounts, one per role (credentials are listed in the README). */
const ACCOUNTS: Record<string, string> = {
  store: "malika.out029",
  dispatcher: "gehiru.dispatch",
  loader: "senash.kandydock",
  driver: "nimsith.veh041",
};
const PASSWORD = "routelanka";

/** One icon and accent per role, so the demo buttons read at a glance. */
const ROLE_LOOK: Record<string, { icon: ReactNode; tint: string }> = {
  dispatcher: { tint: "bg-night text-hivis", icon: <path d="M4 5h16v11H4zM8 20h8M12 16v4M7 12l3-3 2 2 4-4" /> },
  loader: { tint: "bg-amber-soft text-hivis-deep", icon: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" /> },
  driver: { tint: "bg-chill-soft text-chill", icon: <><path d="M2 16V7h11v9M13 10h4l3 3v3h-7" /><circle cx="6.5" cy="17" r="1.8" /><circle cx="16.5" cy="17" r="1.8" /></> },
  store: { tint: "bg-ok-soft text-ok", icon: <path d="M4 10l1.5-5h13L20 10M4 10v10h16V10M4 10h16M9 20v-5h6v5" /> },
};

const POINTS = [
  ["Plans the whole night", "Every order placed on a legal truck, or deferred with the reason."],
  ["Works without signal", "Drivers keep delivering on the hill roads; records sync later."],
  ["Stores told on WhatsApp", "Arrival times, delays and one-tap replies, in Sinhala, Tamil or English."],
];

export default function Login() {
  const router = useRouter();
  const { refresh } = useDemo();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const go = async (u: string, p: string) => {
    setErr("");
    try {
      const a = await api<{ role: string }>("/auth/login", { username: u, password: p }, undefined);
      // The day's view carries who is signed in (their store, depot or vehicle): load it again for this person.
      await refresh();
      const home = ROLES.find((r) => r.role === a.role)!.href;
      // Came here from a screen that needed this role: go back to it.
      const params = new URLSearchParams(window.location.search);
      const next = params.get("role") === a.role ? params.get("next") : null;
      router.push(next && next.startsWith("/") ? next : home);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed.");
    }
  };

  return (
    <main className="grid min-h-dvh bg-night lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[radial-gradient(900px_600px_at_20%_10%,#24344f_0%,#16233a_45%,#0d1728_100%)] px-12 py-10 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <Image src="/brand/routelanka-mark.png" alt="" width={40} height={40} className="size-10 rounded-xl" priority />
          <p className="font-cond text-2xl font-bold leading-none">
            Route<span className="ml-0.5 rounded-sm bg-hivis px-1 text-night">Lanka</span>
          </p>
        </div>
        <div className="rl-hero-grid mt-auto grid grid-cols-[1fr_260px] items-end gap-6 xl:grid-cols-[1fr_300px]">
          <div className="pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hivis">Delivery planning for Waypoint Group</p>
            <h2 className="rl-hero-title mt-3 font-cond text-5xl font-bold leading-[1.02] xl:text-6xl">
              One night.
              <br />
              Four roles.
              <br />
              <span className="bg-gradient-to-r from-hivis to-hivis-2 bg-clip-text text-transparent">Every crate accounted for.</span>
            </h2>
            <ul className="rl-hero-points mt-8 space-y-4">
              {POINTS.map(([h, d]) => (
                <li key={h} className="flex gap-3">
                  <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-hivis/15 text-hivis">
                    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  </span>
                  <span>
                    <span className="block font-semibold">{h}</span>
                    <span className="block text-sm text-white/60">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <IslandMap className="rl-hero-map w-full drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)]" />
        </div>
        <p className="mt-6 text-xs text-white/40">Peliyagoda and Kandy depots · Waypoint Fresh, Style and Tech · Team API4</p>
      </section>

      <section className="grid place-items-center bg-paper px-4 py-10 lg:rounded-l-[28px] lg:shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.5)]">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <Image src="/brand/routelanka-mark.png" alt="" width={56} height={56} className="size-14 rounded-xl" priority />
            <div>
              <p className="font-cond text-3xl font-bold leading-none">
                Route<span className="ml-0.5 rounded-sm bg-hivis px-1 text-night">Lanka</span>
              </p>
              <p className="mt-1.5 text-sm text-mute">Delivery planning for Waypoint Group</p>
            </div>
          </div>
          <Card className="p-6 sm:p-8">
            <h1 className="font-cond text-3xl font-bold">Welcome back</h1>
            <p className="mt-1 text-sm text-mute">Sign in to tonight&apos;s delivery run.</p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void go(user, pass);
              }}
            >
              <label className="block">
                <span className="text-sm font-semibold">Username</span>
                <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required className="mt-1 h-11 w-full rounded-lg border border-line bg-paper/60 px-3 outline-none transition focus:border-night focus:bg-card focus:ring-4 focus:ring-hivis/30" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Password</span>
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required className="mt-1 h-11 w-full rounded-lg border border-line bg-paper/60 px-3 outline-none transition focus:border-night focus:bg-card focus:ring-4 focus:ring-hivis/30" />
              </label>
              {err && (
                <p role="alert" className="text-sm font-semibold text-late">
                  {err}
                </p>
              )}
              <Btn variant="primary" size="lg" className="w-full" type="submit">
                Sign in
              </Btn>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-mute">
              <span className="h-px flex-1 bg-line" />
              Demo access
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {ROLES.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  onClick={() => void go(ACCOUNTS[r.role], PASSWORD)}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-night/40 hover:shadow-md"
                >
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${ROLE_LOOK[r.role].tint}`}>
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {ROLE_LOOK[r.role].icon}
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{r.label}</span>
                    <span className="block truncate text-xs text-mute">{seed.meta.personas[r.role].name}</span>
                  </span>
                </button>
              ))}
            </div>
          </Card>
          <NightPicker />
        </div>
      </section>
    </main>
  );
}

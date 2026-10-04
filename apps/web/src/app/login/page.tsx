"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <main className="grid min-h-dvh place-items-center bg-night px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center text-white">
          <Image src="/brand/routelanka-mark.png" alt="" width={56} height={56} className="size-14 rounded-xl" priority />
          <div>
            <p className="font-cond text-3xl font-bold leading-none">
              Route<span className="ml-0.5 rounded-sm bg-hivis px-1 text-night">Lanka</span>
            </p>
            <p className="mt-1.5 text-sm text-white/70">Delivery planning for Waypoint Group</p>
          </div>
        </div>
        <Card className="p-6 shadow-xl sm:p-8">
          <h1 className="font-cond text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-mute">Use your RouteLanka account to continue.</p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void go(user, pass);
            }}
          >
            <label className="block">
              <span className="text-sm font-semibold">Username</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required className="mt-1 h-11 w-full rounded-md border border-line px-3 outline-none focus:border-night focus:ring-2 focus:ring-hivis/60" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Password</span>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required className="mt-1 h-11 w-full rounded-md border border-line px-3 outline-none focus:border-night focus:ring-2 focus:ring-hivis/60" />
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
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.role}
                type="button"
                onClick={() => void go(ACCOUNTS[r.role], PASSWORD)}
                className="rounded-md border border-line px-3 py-2.5 text-left transition-colors hover:border-night hover:bg-night/5"
              >
                <span className="block text-sm font-semibold">{r.label}</span>
                <span className="block text-xs text-mute">{seed.meta.personas[r.role].name}</span>
              </button>
            ))}
          </div>
        </Card>
        <NightPicker />
      </div>
    </main>
  );
}

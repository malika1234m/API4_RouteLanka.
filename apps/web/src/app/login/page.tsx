"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES } from "@/components/Shell";
import { Btn, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/store";

/** Seeded demo accounts, one per role. Passwords are demo-only and shown on purpose. */
const ACCOUNTS: Record<string, { user: string; sign: string }> = {
  store: { user: "malika.out029", sign: "Phone number + PIN in production" },
  dispatcher: { user: "gehiru.dispatch", sign: "Company email in production" },
  loader: { user: "senash.kandydock", sign: "Shared dock tablet, personal PIN" },
  driver: { user: "nimsith.veh041", sign: "Own phone, phone number + PIN" },
};
const PASSWORD = "routelanka";

export default function Login() {
  const router = useRouter();
  const { dispatch } = useDemo();
  const [fresh, setFresh] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const go = async (u: string, p: string) => {
    setErr("");
    try {
      const a = await api<{ role: string }>("/auth/login", { username: u, password: p }, undefined);
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
      <div className="w-full max-w-4xl">
        <div className="mb-6 flex items-center gap-3 text-white">
          <Image src="/brand/routelanka-mark.png" alt="" width={48} height={48} className="size-12 rounded-lg" priority />
          <div>
            <p className="font-cond text-3xl font-bold leading-none">
              Route<span className="ml-0.5 rounded-sm bg-hivis px-1 text-night">Lanka</span>
            </p>
            <p className="text-sm text-white/70">Delivery planning for Waypoint Group</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <Card className="p-5">
            <h1 className="font-cond text-2xl font-bold">Sign in</h1>
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void go(user, pass);
              }}
            >
              <label className="block">
                <span className="text-sm font-semibold">Username</span>
                <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" className="mt-1 h-11 w-full rounded-md border border-line px-3" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Password</span>
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" className="mt-1 h-11 w-full rounded-md border border-line px-3" />
              </label>
              {err && <p className="text-sm font-semibold text-late">{err}</p>}
              <Btn variant="primary" size="lg" className="w-full" type="submit">
                Sign in
              </Btn>
            </form>
            <p className="mt-3 text-xs text-mute">Each person sees only their own work. Field staff sign in with a phone number and PIN; no email needed.</p>
          </Card>
          <Card className="p-5">
            <p className="font-cond text-lg font-semibold">Demo accounts</p>
            <p className="text-sm text-mute">
              Password for all four: <b className="font-cond text-base text-night">{PASSWORD}</b>. Or sign in with one click.
            </p>
            <ul className="mt-3 space-y-2">
              {ROLES.map((r) => (
                <li key={r.role} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {r.label} <span className="font-normal text-mute">· {r.who}</span>
                    </span>
                    <span className="block font-cond text-sm">{ACCOUNTS[r.role].user}</span>
                    <span className="block text-xs text-mute">{ACCOUNTS[r.role].sign}</span>
                  </span>
                  <Btn onClick={() => void go(ACCOUNTS[r.role].user, PASSWORD)}>Sign in</Btn>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <p className="mt-4 text-center text-xs text-white/60">
          A sample night, Friday 24 April, shared by all four roles.{" "}
          <button
            onClick={() => {
              dispatch({ type: "reset" });
              setFresh(true);
            }}
            className="underline hover:text-white"
          >
            {fresh ? "New demo day started" : "Start a new demo day"}
          </button>
        </p>
      </div>
    </main>
  );
}

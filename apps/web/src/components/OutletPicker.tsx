"use client";

import { useSyncExternalStore } from "react";
import { seed } from "@/lib/seed";

const KEY = "routelanka-store-outlet";
const EVENT = "routelanka-outlet";

/**
 * The stores the signed-in store account covers: one store, every store in an area manager's district,
 * or (the demo account) all of them.
 */
const myStores = () => {
  const me = seed.me.store;
  if (me?.outlet_id && !me.demo) return seed.outlets.filter((o) => o.outlet_id === me.outlet_id);
  if (me?.district) return seed.outlets.filter((o) => o.district === me.district);
  return seed.outlets;
};
const lockedOutlet = () => (seed.me.store?.outlet_id && !seed.me.store.demo ? seed.me.store.outlet_id : undefined);

const read = () => {
  const locked = lockedOutlet();
  if (locked) return locked;
  const mine = myStores();
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  // The last store viewed, if this account covers it; else the account's first store.
  if (saved && mine.some((o) => o.outlet_id === saved)) return saved;
  return seed.me.store?.district ? (mine[0]?.outlet_id ?? seed.personas.store.outlet_id) : seed.personas.store.outlet_id;
};
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
};

/** The store manager's outlet. Switchable in the prototype so judges can view any store. */
export function useOutlet(): [string, (id: string) => void] {
  const id = useSyncExternalStore(subscribe, read, () => seed.personas.store.outlet_id);
  const set = (v: string) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  };
  return [id, set];
}

export function OutletPicker({ id, onChange }: { id: string; onChange: (id: string) => void }) {
  if (lockedOutlet()) {
    const o = seed.outlets.find((x) => x.outlet_id === id);
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <span className="text-mute">Outlet</span>
        <span className="font-cond text-base font-semibold">
          {id}
          {o ? ` · ${o.brand} ${o.district}` : ""}
        </span>
      </span>
    );
  }
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-mute">{seed.me.store?.district ? `${seed.me.store.district} stores` : "Outlet"}</span>
      <select value={id} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-line bg-card px-2 font-cond text-base font-semibold">
        {myStores().map((o) => (
          <option key={o.outlet_id} value={o.outlet_id}>
            {o.outlet_id} · {o.brand} {o.district}
          </option>
        ))}
      </select>
    </label>
  );
}

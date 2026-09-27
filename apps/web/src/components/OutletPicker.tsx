"use client";

import { useSyncExternalStore } from "react";
import { seed } from "@/lib/seed";

const KEY = "routelanka-store-outlet";
const EVENT = "routelanka-outlet";

const read = () => {
  try {
    return localStorage.getItem(KEY) ?? seed.personas.store.outlet_id;
  } catch {
    return seed.personas.store.outlet_id;
  }
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
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-mute">Outlet</span>
      <select value={id} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-line bg-card px-2 font-cond text-base font-semibold">
        {seed.outlets.map((o) => (
          <option key={o.outlet_id} value={o.outlet_id}>
            {o.outlet_id} · {o.brand} {o.district}
          </option>
        ))}
      </select>
    </label>
  );
}

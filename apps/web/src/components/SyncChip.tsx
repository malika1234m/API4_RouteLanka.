"use client";

import { IconNoSignal, IconSignal } from "@/components/ui";
import { useDemo } from "@/lib/store";

export function SyncChip() {
  const { s } = useDemo();
  const n = s.driver.outbox.length;
  if (!s.driver.online)
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-hivis px-2 py-0.5 text-sm font-semibold text-night">
        <IconNoSignal /> {n ? `${n} saved on phone` : "No signal"}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-sm text-white/80">
      <IconSignal /> All sent
    </span>
  );
}

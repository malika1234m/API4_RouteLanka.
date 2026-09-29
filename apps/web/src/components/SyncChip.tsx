"use client";

import { IconNoSignal, IconSignal } from "@/components/ui";
import { useDemo } from "@/lib/store";
import { useT } from "@/lib/i18n";

export function SyncChip() {
  const { s } = useDemo();
  const { t } = useT("driver");
  const n = s.driver.outbox.length;
  if (!s.driver.online)
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-hivis px-2 py-0.5 text-sm font-semibold text-night">
        <IconNoSignal /> {n ? t("{n} saved on phone", { n }) : t("No signal")}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-white/80" title={t("All sent")}>
      <IconSignal /> <span className="hidden sm:inline">{t("All sent")}</span>
    </span>
  );
}

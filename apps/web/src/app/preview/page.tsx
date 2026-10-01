"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Wordmark } from "@/components/Shell";

const SCREENS = [
  { path: "/driver", label: "Driver · today's run" },
  { path: "/dock", label: "Loader · dock queue" },
  { path: "/store", label: "Store · my deliveries" },
  { path: "/store/order", label: "Store · place order" },
  { path: "/store/messages", label: "Store · WhatsApp" },
];

/** Shows any screen inside a phone-sized frame, for demos and screenshots. Shares state with other tabs. */
function Preview() {
  const params = useSearchParams();
  const path = params.get("path") ?? "/driver";
  return (
    <div className="flex min-h-dvh flex-col items-center gap-3 bg-night px-4 py-3 text-white">
      <div className="flex w-full max-w-3xl flex-wrap items-center gap-3">
        <Wordmark light />
        <span className="text-sm text-white/60">Phone preview · 390 × 844</span>
        <nav className="ml-auto flex flex-wrap gap-1" aria-label="Screens">
          {SCREENS.map((s) => (
            <Link key={s.path} href={`/preview?path=${encodeURIComponent(s.path)}`} className={`rounded-md px-2.5 py-1.5 text-sm ${s.path === path ? "bg-hivis font-semibold text-night" : "text-white/70 hover:bg-white/10"}`}>
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="rounded-[44px] bg-black p-3 shadow-2xl ring-1 ring-white/15">
        <iframe key={path} src={path} title="Phone preview" className="h-[min(844px,calc(100dvh-8rem))] w-[min(390px,calc(100vw-4rem))] rounded-[32px] bg-paper" />
      </div>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}

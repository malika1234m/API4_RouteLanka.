"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { OutletPicker, useOutlet } from "@/components/OutletPicker";
import { Shell } from "@/components/Shell";
import { Rich } from "@/components/ui";
import { api } from "@/lib/api";
import { renderMessage, useT } from "@/lib/i18n";
import { outletById } from "@/lib/seed";
import { useDemo, type Action } from "@/lib/store";

/** A WhatsApp message as the notifier stored it: an English template (the translation key) and values. */
interface Msg {
  id: string;
  direction: "in" | "out";
  template: string;
  vars: Record<string, string | number | { $t: string } | null>;
  replies: { label: string; command?: Record<string, unknown>; link?: string }[] | null;
  day: "Yesterday" | "Today";
  at: string;
  order_ref: string | null;
  wa_status?: "local" | "pending" | "sent" | "delivered" | "read" | "failed" | "skipped";
  wa_error?: string | null;
}

/** WhatsApp delivery ticks for a message to the store: sent ✓, delivered ✓✓, read (blue) ✓✓. */
function Ticks({ m }: { m: Msg }) {
  const st = m.wa_status;
  if (!st || st === "local" || st === "skipped") return null;
  if (st === "failed") return <span className="ml-1 text-late" title={m.wa_error ?? "Not delivered"}>⚠</span>;
  if (st === "pending") return <span className="ml-1" title="Waiting to send">🕓</span>;
  return <span className={`ml-1 ${st === "read" ? "text-[#53bdeb]" : ""}`} title={`WhatsApp: ${st}`}>{st === "sent" ? "✓" : "✓✓"}</span>;
}

export default function Messages() {
  const { s, dispatch } = useDemo();
  const { t, lang } = useT("store");
  const [outletId, setOutlet] = useOutlet();
  const [msgs, setMsgs] = useState<Msg[]>([]);

  // Walkthrough links open a specific outlet's thread.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("outlet");
    if (want && outletById.has(want)) setOutlet(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch whenever anything happens in the day (the notifier writes messages from those events).
  const latest = s.feed[0]?.id;
  useEffect(() => {
    let cancelled = false;
    const load = () => api<Msg[]>(`/messages?outlet=${outletId}`).then((m) => !cancelled && setMsgs(m)).catch(() => {});
    void load();
    // The notifier works asynchronously: look again shortly after an event.
    const again = setTimeout(load, 800);
    return () => {
      cancelled = true;
      clearTimeout(again);
    };
  }, [outletId, latest, s.published]);

  const outlet = outletById.get(outletId);

  return (
    <Shell width="narrow" role="store">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-cond text-3xl font-bold">{t("Messages")}</h1>
        <OutletPicker id={outletId} onChange={setOutlet} />
      </div>
      <p className="mt-1 text-sm text-mute">{t("Messages are sent in the store's chosen language. No app to install: outlet staff change often.")}</p>

      <div className="mx-auto mt-4 max-w-md overflow-hidden rounded-2xl border border-line shadow-sm">
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
          <Image src="/brand/routelanka-mark.png" alt="" width={36} height={36} className="size-9 rounded-full bg-white" />
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{t("Waypoint Deliveries")} ✓</p>
            <p className="text-xs text-white/75">
              {t("Business account")} · {outlet?.outlet_id}
            </p>
          </div>
        </div>
        <div className="max-h-[70dvh] min-h-96 space-y-2 overflow-y-auto bg-[#efeae2] px-3 py-4">
          {msgs.length === 0 && <p className="text-center text-sm text-mute">{t("No messages yet.")}</p>}
          {msgs.map((m, i) => {
            const sep = i === 0 || msgs[i - 1].day !== m.day;
            // Reply buttons disappear once the store has answered for that order.
            const answered = msgs.slice(i + 1).some((n) => n.direction === "out" && n.order_ref === m.order_ref);
            return (
              <div key={m.id}>
                {sep && (
                  <p className="my-2 text-center">
                    <span className="rounded-md bg-white/80 px-2 py-0.5 text-xs text-mute shadow-sm">{m.day === "Today" ? t("Today") : t("Yesterday")}</span>
                  </p>
                )}
                <div className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[15px] leading-snug shadow-sm ${m.direction === "out" ? "bg-[#d9fdd3]" : "bg-white"}`}>
                    <Rich text={renderMessage(lang, m.template, m.vars)} />
                    <span className="ml-2 inline-block translate-y-0.5 text-[11px] text-mute">
                      {m.at}
                      {m.direction === "out" ? <span className="ml-1 text-[#53bdeb]">✓✓</span> : <Ticks m={m} />}
                    </span>
                  </div>
                </div>
                {m.replies && !answered && (
                  <div className="mt-1 flex max-w-[85%] flex-col gap-1">
                    {m.replies.map((r) =>
                      r.link ? (
                        <Link key={r.label} href={r.link} className="rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-[#027eb5] shadow-sm">
                          {renderMessage(lang, r.label)}
                        </Link>
                      ) : (
                        <button key={r.label} onClick={() => void dispatch(r.command as Action).catch(() => {})} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#027eb5] shadow-sm">
                          {renderMessage(lang, r.label)}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}

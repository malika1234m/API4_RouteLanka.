"use client";

import Link from "next/link";
import { useEffect } from "react";
import Image from "next/image";
import { OutletPicker, useOutlet } from "@/components/OutletPicker";
import { Shell } from "@/components/Shell";
import { Rich } from "@/components/ui";
import { handoverCode } from "@/lib/handover";
import { useT, type T } from "@/lib/i18n";
import { outletById, REASON_LABEL, tripKey } from "@/lib/seed";
import { useDemo, type DemoState } from "@/lib/store";
import type { Order } from "@/lib/types";
import { delayedEta } from "@/lib/delay";
import { DELAY_REASONS } from "@/lib/roads";

type Msg = { key: string; day: "Yesterday" | "Today"; at: string; side: "in" | "out"; text: string; reply?: { label: string; ack?: string; receive?: string; problem?: string; wait?: string; tomorrow?: string }[] };

/** Every message the outlet would get on WhatsApp, rebuilt from the shared record. */
function thread(s: DemoState, outletId: string, t: T): Msg[] {
  const orders = s.orders.filter((o) => o.outlet_id === outletId);
  const unit = (o: Order) => t(o.brand === "Fresh" ? "crates" : "units");
  const kind = (o: Order) => t(o.temp_requirement === "chilled" ? "chilled" : "dry goods");
  const published = [...s.feed].reverse().find((f) => f.text.startsWith("Plan published"))?.at;
  const out: Msg[] = [];

  for (const o of orders)
    out.push({ key: `rcv-${o.order_ref}`, day: "Yesterday", at: "15:12", side: "in", text: t("We received your order {r} ({n} {u}) for {d}. You'll get the arrival time tonight.", { r: o.order_ref, n: o.order_units, u: unit(o), d: t("Friday 24 April") }) });

  for (const o of s.placed.filter((p) => p.outlet_id === outletId)) {
    const at = s.feed.find((f) => f.text.includes(o.order_ref))?.at ?? "";
    out.push({ key: `rcv-${o.order_ref}`, day: "Today", at, side: "in", text: t("We received your order {r} ({n} {u}) for {d}. You'll get the arrival time tonight.", { r: o.order_ref, n: o.order_units, u: unit(o), d: t("Saturday 25 April") }) });
  }

  if (s.published && published)
    for (const o of orders) {
      const st = s.states[o.order_ref];
      if (st.deferred) {
        out.push({
          key: `def-${o.order_ref}`,
          day: "Today",
          at: published,
          side: "in",
          text: t("Your {k} delivery is **not coming tomorrow morning**. Reason: {r}. It moves to **Saturday 25 April** and you are first in line.", { k: kind(o), r: t(REASON_LABEL[o.reason ?? "dispatcher_choice"].toLowerCase()) }),
          reply: s.acks[o.order_ref] ? undefined : [{ label: t("Noted, thanks"), ack: o.order_ref }],
        });
        if (s.acks[o.order_ref]) out.push({ key: `ack-${o.order_ref}`, day: "Today", at: s.acks[o.order_ref], side: "out", text: t("Noted, thanks") });
        continue;
      }
      const late = (o.pred_late_prob ?? 0) >= 0.5;
      out.push({
        key: `plan-${o.order_ref}`,
        day: "Today",
        at: published,
        side: "in",
        text: late
          ? t("Your {k} delivery is expected **{w}**, after your window closes at {c}. Please keep a receiver on until it arrives.", { k: kind(o), w: o.pred_window, c: o.window_close_time })
          : t("Your {k} delivery ({n} {u}) arrives **{w}** tomorrow on {v}.", { k: kind(o), n: o.order_units, u: unit(o), w: o.pred_window, v: o.vehicle_id }),
      });
      out.push({ key: `code-${o.order_ref}`, day: "Today", at: published, side: "in", text: `🔐 ${t("Handover code for {r}: **{c}**. Give it to the driver only when the goods are in front of you.", { r: o.order_ref, c: handoverCode(o.order_ref) })}` });
      if (st.loadDecision === "send_short") {
        const at = s.feed.find((f) => f.ref === o.order_ref && f.role === "dispatcher")?.at ?? published;
        out.push({ key: `short-${o.order_ref}`, day: "Today", at, side: "in", text: t("Your {k} delivery will be **{q} {u} short** (not in stock). The balance comes on the next run.", { k: kind(o), q: st.loadFlag?.qty, u: unit(o) }) });
      }
      const left = s.departed[tripKey(o)];
      if (left) out.push({ key: `left-${o.order_ref}`, day: "Today", at: left, side: "in", text: `🚚 ${t("Your delivery left the depot at {t} on {v}. Expected {w}.", { t: left, v: o.vehicle_id, w: o.pred_window })}` });
      const plan = s.delayPlan[o.order_ref];
      if (plan && s.delayToldAt && s.driver.delay) {
        const why = t(DELAY_REASONS.find((r) => r.id === s.driver.delay!.reason)!.label).toLowerCase();
        const eta = delayedEta(s, o);
        const reply = s.storeReplies[o.order_ref];
        const text =
          plan === "late"
            ? t("Your delivery is held up on the way ({r}). New estimate **{w}**.", { r: why, w: eta ? `${eta.from}–${eta.to}` : "" }) + (eta?.late ? " " + t("That is after your window closes at {c}.", { c: o.window_close_time }) : "")
            : plan === "move"
              ? t("Your delivery is held up on the way ({r}), so it now comes on **{v}**. We'll confirm the time when it leaves.", { r: why, v: st.reassignedTo })
              : t("Your {k} delivery can't reach you before you open ({r}). It goes back to the depot and comes on **tomorrow's first run**; you're first in line.", { k: kind(o), r: why });
        out.push({ key: `delay-${o.order_ref}`, day: "Today", at: s.delayToldAt, side: "in", text: `🚧 ${text}`, reply: plan === "late" && !reply ? [{ label: t("We'll wait"), wait: o.order_ref }, { label: t("Can't receive, send tomorrow"), tomorrow: o.order_ref }] : undefined });
        if (reply) {
          out.push({ key: `dr-${o.order_ref}`, day: "Today", at: reply.at, side: "out", text: reply.reply === "wait" ? t("We'll wait") : t("Can't receive, send tomorrow") });
          out.push({ key: `drr-${o.order_ref}`, day: "Today", at: reply.at, side: "in", text: reply.reply === "wait" ? t("Thanks. We'll let the driver know you're expecting the delivery.") : t("Understood. It comes back to the depot and goes first on tomorrow's run.") });
        }
      }
      if (st.stage === "delivered" || st.stage === "received") {
        const at = st.syncedAt ?? st.deliveredAt ?? "";
        const vars = { t: st.deliveredAt, a: st.deliveredUnits, b: o.order_units, u: unit(o), n: st.pod?.name };
        out.push({
          key: `dlv-${o.order_ref}`,
          day: "Today",
          at,
          side: "in",
          text: `📦 ${st.pod?.method === "code" ? t("Delivered at {t}: {a} of {b} {u}, verified with your handover code. Please check and confirm.", vars) : t("Delivered at {t}: {a} of {b} {u}, signed by {n}. Please check and confirm.", vars)}`,
          reply: st.receipt ? undefined : [{ label: `✅ ${t("All received")}`, receive: o.order_ref }, { label: `⚠️ ${t("Report a problem")}`, problem: o.order_ref }],
        });
      }
      if (st.receipt) {
        const at = s.feed.find((f) => f.ref === o.order_ref && f.role === "store")?.at ?? "";
        out.push({ key: `rc-${o.order_ref}`, day: "Today", at, side: "out", text: st.receipt.ok ? `✅ ${t("All received")}` : `⚠️ ${t("Report a problem")}` });
        out.push({ key: `rcr-${o.order_ref}`, day: "Today", at, side: "in", text: st.receipt.ok ? t("Thank you. Your receipt is recorded.") : t("We've logged {q} × {k}. The dispatcher will arrange a credit or redelivery.", { q: st.receipt.issue?.qty, k: t(st.receipt.issue?.kind ?? "") }) });
      }
    }

  const dayRank = { Yesterday: 0, Today: 1 };
  return out.map((m, i) => ({ m, i })).sort((a, b) => dayRank[a.m.day] - dayRank[b.m.day] || a.m.at.localeCompare(b.m.at) || a.i - b.i).map((x) => x.m);
}

export default function Messages() {
  const { s, dispatch } = useDemo();
  const { t } = useT("store");
  const [outletId, setOutlet] = useOutlet();
  // Walkthrough links open a specific outlet's thread.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("outlet");
    if (want && outletById.has(want)) setOutlet(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const outlet = outletById.get(outletId)!;
  const msgs = thread(s, outletId, t);

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
              {t("Business account")} · {outlet.outlet_id}
            </p>
          </div>
        </div>
        <div className="max-h-[70dvh] min-h-96 space-y-2 overflow-y-auto bg-[#efeae2] px-3 py-4">
          {msgs.length === 0 && <p className="text-center text-sm text-mute">{t("No messages yet.")}</p>}
          {msgs.map((m, i) => {
            const sep = i === 0 || msgs[i - 1].day !== m.day;
            return (
              <div key={m.key}>
                {sep && (
                  <p className="my-2 text-center">
                    <span className="rounded-md bg-white/80 px-2 py-0.5 text-xs text-mute shadow-sm">{m.day === "Today" ? t("Today") : t("Yesterday")}</span>
                  </p>
                )}
                <div className={`flex ${m.side === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[15px] leading-snug shadow-sm ${m.side === "out" ? "bg-[#d9fdd3]" : "bg-white"}`}>
                    <Rich text={m.text} />
                    <span className="ml-2 inline-block translate-y-0.5 text-[11px] text-mute">
                      {m.at}
                      {m.side === "out" && <span className="ml-1 text-[#53bdeb]">✓✓</span>}
                    </span>
                  </div>
                </div>
                {m.reply && (
                  <div className="mt-1 flex max-w-[85%] flex-col gap-1">
                    {m.reply.map((r) =>
                      r.problem ? (
                        <Link key={r.label} href={`/store/receive/${r.problem}`} className="rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-[#027eb5] shadow-sm">
                          {r.label}
                        </Link>
                      ) : (
                        <button
                          key={r.label}
                          onClick={() => (r.ack ? dispatch({ type: "ack", ref: r.ack, via: "whatsapp" }) : r.wait ? dispatch({ type: "storeReply", ref: r.wait, reply: "wait" }) : r.tomorrow ? dispatch({ type: "storeReply", ref: r.tomorrow, reply: "tomorrow" }) : r.receive && dispatch({ type: "receive", ref: r.receive, ok: true }))}
                          className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#027eb5] shadow-sm"
                        >
                          {r.label}
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

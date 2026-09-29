"use client";

import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { ASSUME, BASELINE, fmtRs } from "@/lib/business";
import { seed } from "@/lib/seed";
import { useDemo } from "@/lib/store";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function Impact() {
  const { s } = useDemo();
  const served = s.orders.filter((o) => o.decision === "served");
  const deferred = s.orders.filter((o) => o.decision === "deferred");
  const warnedLate = served.filter((o) => (o.pred_late_prob ?? 0) >= 0.5);
  const repeat = deferred.filter((o) => o.deferred_yesterday > 0 || o.days_since_last_served > 1);
  const delivered = s.orders.filter((o) => ["delivered", "received"].includes(s.states[o.order_ref].stage));
  const coded = delivered.filter((o) => s.states[o.order_ref].pod?.method === "code");
  const receipts = s.orders.filter((o) => s.states[o.order_ref].receipt);
  const issues = receipts.filter((o) => !s.states[o.order_ref].receipt?.ok);
  const acked = deferred.filter((o) => s.acks[o.order_ref]);
  const avgCrates = deferred.filter((o) => o.temp_requirement === "chilled").reduce((a, o) => a + o.order_units, 0) / Math.max(1, deferred.filter((o) => o.temp_requirement === "chilled").length);
  const valuePerDeferral = avgCrates * ASSUME.crateValue * ASSUME.lossShare;
  const fleet = seed.vehicles.length;
  const monthly = fleet * ASSUME.subscriptionPerVehicle;
  const deferralsPerMonth = (BASELINE.deferredTotal / BASELINE.operatingDays) * 26;

  const rows: { k: string; why: string; base: string; now: string; target: string }[] = [
    { k: "Deliveries after the window closes", why: "Predicted before loading; the store and driver are told, and the dispatcher can move the stop.", base: `${BASELINE.lateShare}%`, now: s.published ? `${warnedLate.length} flagged in advance` : "—", target: "12%" },
    { k: "Nights with a deferral", why: "Repair priority and hire-or-defer add refrigerated space where it pays.", base: `${BASELINE.deferralNights}%`, now: s.published ? `${deferred.length} deferred tonight` : "—", target: "30%" },
    { k: "Deferrals hitting a recently skipped outlet", why: "A skipped outlet goes first in line next run.", base: `${BASELINE.repeatSkipShare}%`, now: s.published ? pct(repeat.length, deferred.length) : "—", target: "0%" },
    { k: "Stores told why and when, before the run", why: "Every deferral carries a reason and a new date, on WhatsApp in their language.", base: "Not recorded", now: s.published ? `100% · ${acked.length} acknowledged` : "—", target: "100%" },
    { k: "Deliveries with verified proof", why: "Store's handover code, checked on the phone with no signal.", base: "Paper and phone calls", now: delivered.length ? pct(coded.length, delivered.length) : "—", target: "95%" },
    { k: "Disputes settled from two records", why: "Driver's record and store's confirmation, both time-stamped.", base: "Not recorded", now: receipts.length ? `${issues.length} of ${receipts.length} receipts had an issue` : "—", target: "Within 24 h" },
  ];

  return (
    <Shell role="dispatcher" width="wide">
      <h1 className="font-cond text-2xl font-bold leading-tight">Impact</h1>
      <p className="text-sm text-mute">What RouteLanka should change, measured against two years of Waypoint&apos;s own records. For the operations head and the pilot review.</p>

      <Card className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-paper text-left text-xs text-mute">
            <tr>
              <th className="px-4 py-2 font-medium">Pilot scorecard · Peliyagoda Fresh, 90 days</th>
              <th className="px-3 py-2 font-medium">Baseline (history)</th>
              <th className="px-3 py-2 font-medium">Tonight</th>
              <th className="px-4 py-2 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <span className="block font-semibold">{r.k}</span>
                  <span className="block text-xs text-mute">{r.why}</span>
                </td>
                <td className="px-3 py-3 font-cond text-lg font-semibold">{r.base}</td>
                <td className="px-3 py-3 font-cond text-lg font-semibold">{r.now}</td>
                <td className="px-4 py-3 font-cond text-lg font-bold text-ok">{r.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2 text-xs text-mute">
          Baselines from {BASELINE.operatingDays} operating days of delivery history. {BASELINE.chilledShare}% of deferred orders were chilled Fresh, so refrigerated capacity is the lever. Targets are the pilot&apos;s commitments, not results.
        </p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="font-cond text-lg font-semibold">Business case</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-mute">Subscription ({fleet} vehicles × {fmtRs(ASSUME.subscriptionPerVehicle)})</dt><dd className="font-cond font-semibold">{fmtRs(monthly)} / month</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-mute">Value lost per chilled deferral</dt><dd className="font-cond font-semibold">{fmtRs(valuePerDeferral)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-mute">Deferred orders per month today</dt><dd className="font-cond font-semibold">≈ {Math.round(deferralsPerMonth)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-line pt-1.5"><dt className="font-semibold">Break-even</dt><dd className="font-cond text-lg font-bold text-ok">{(monthly / valuePerDeferral).toFixed(1)} deferrals avoided / month</dd></div>
          </dl>
          <p className="mt-2 text-xs text-mute">Money figures are assumptions to replace with Waypoint&apos;s own (see Fleet). Deferral counts are from the history.</p>
        </Card>
        <Card className="p-4">
          <p className="font-cond text-lg font-semibold">Why people will actually use it</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li><b>Stores:</b> WhatsApp, no app to install, in Sinhala, Tamil or English.</li>
            <li><b>Drivers:</b> their own phone, works with no signal, three taps a stop.</li>
            <li><b>Loaders:</b> big buttons for gloved hands, nothing to print.</li>
            <li><b>Dispatcher:</b> one screen of decisions, not four phone calls.</li>
          </ul>
        </Card>
        <Card className="p-4">
          <p className="font-cond text-lg font-semibold">Rollout</p>
          <ol className="mt-2 space-y-1.5 text-sm">
            <li><b>Weeks 1–2:</b> Peliyagoda Fresh, dispatcher and refrigerated fleet. Run alongside today&apos;s process.</li>
            <li><b>Weeks 3–6:</b> all Peliyagoda brands; WhatsApp updates to every outlet.</li>
            <li><b>Weeks 7–12:</b> Kandy depot, Sinhala and Tamil for field staff, workshop priority list weekly.</li>
            <li><b>Review:</b> this scorecard at day 90 decides the full rollout.</li>
          </ol>
        </Card>
      </div>
    </Shell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { formatPhone } from "@routelanka/domain";
import { Shell } from "@/components/Shell";
import { Card, Chip } from "@/components/ui";
import { api } from "@/lib/api";
import { useDemo } from "@/lib/store";

interface LogRow {
  id: number;
  at: string;
  direction: "outbound" | "webhook";
  kind: string;
  http_status: number | null;
  signature_ok: boolean | null;
  phone: string | null;
  request: unknown;
  response: unknown;
  note: string | null;
  outlet_id: string | null;
  order_ref: string | null;
  text: string | null;
  wa_status: string | null;
  wa_error: string | null;
}
interface Console {
  config: { mode: "off" | "simulator" | "cloud"; endpoint: string; webhook: string; signing: string };
  stats: Record<string, number>;
  timing: { to_delivered: number | null; to_read: number | null };
  contacts: { outlet_id: string; phone: string; live: boolean; last_inbound_at: string | null }[];
  templates: { name: string; language: string; category: string; components: { type: string; text?: string; buttons?: { text: string }[] }[] }[];
  log: LogRow[];
}

const STATUSES = ["pending", "sent", "delivered", "read", "failed", "skipped"] as const;
const tone = (ok: boolean) => (ok ? "text-ok" : "text-late");
const secs = (n: number | null) => (n == null ? "–" : n < 10 ? `${n.toFixed(1)} s` : `${Math.round(n)} s`);

/** The WhatsApp integration as it happens: every Cloud API request, every webhook, and what each did. */
export default function WhatsAppConsole() {
  const { s } = useDemo();
  const [data, setData] = useState<Console | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"messages" | "statuses" | "problems" | "all">("messages");
  const [outlet, setOutlet] = useState("OUT029");

  useEffect(() => {
    let live = true;
    const load = () => api<Console>("/whatsapp/console").then((d) => live && setData(d)).catch(() => {});
    void load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [s.feed[0]?.id]);

  const problem = (r: LogRow) => (r.http_status ?? 0) >= 300 || r.http_status === 0 || r.signature_ok === false || r.wa_status === "failed";
  const rows = (data?.log ?? []).filter(
    (r) =>
      (filter === "all" || (filter === "problems" ? problem(r) : filter === "statuses" ? r.kind === "statuses" : r.kind !== "statuses")) &&
      // Rejected webhooks stay visible whatever the store filter: they matter for every store.
      (!outlet || r.outlet_id === outlet || r.signature_ok === false),
  );
  const toggle = (id: number) => setOpen((o) => (o.has(id) ? (o.delete(id), new Set(o)) : new Set(o.add(id))));
  const store = data?.contacts.find((c) => c.outlet_id === "OUT029");

  return (
    <Shell role="dispatcher" width="wide">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-cond text-2xl font-bold leading-tight">WhatsApp integration</h1>
          <p className="max-w-3xl text-sm text-mute">
            Store messages go out through the WhatsApp Business Platform (Cloud API). Each request below is exactly what was sent, and each webhook exactly what came back, with its
            signature check. Delivery ticks and the stores&apos; replies arrive by webhook and act through the same rules as the app.
          </p>
        </div>
        {data && (
          <Chip tone={data.config.mode === "off" ? "late" : "ok"}>
            {data.config.mode === "cloud" ? "Meta Cloud API" : data.config.mode === "simulator" ? "Cloud API simulator" : "Off: in-app only"}
          </Chip>
        )}
        <a href={store ? `/wa-sim?phone=${store.phone}` : "/wa-sim"} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md bg-[#25d366] px-3 text-sm font-semibold text-white">
          Open the stores&apos; phones
        </a>
      </div>

      {data && (
        <>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="p-4 text-sm">
              <p className="font-semibold">Connection</p>
              <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1">
                <dt className="text-mute">Sends to</dt>
                <dd className="break-all font-mono text-xs">POST {data.config.endpoint}</dd>
                <dt className="text-mute">Webhook</dt>
                <dd className="break-all font-mono text-xs">{data.config.webhook}</dd>
                <dt className="text-mute">Signatures</dt>
                <dd>X-Hub-Signature-256 (HMAC-SHA256 of the raw body), {data.config.signing}</dd>
                <dt className="text-mute">Walkthrough store</dt>
                <dd>{store ? `OUT029 · ${formatPhone(store.phone)}${store.live ? " (live number)" : " (demo number)"}` : "–"}</dd>
              </dl>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-semibold">This demo day&apos;s store messages</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {STATUSES.map((st) => (
                  <div key={st} className="rounded-md bg-paper px-2 py-1.5">
                    <dt className="text-xs capitalize text-mute">{st}</dt>
                    <dd className={`font-cond text-xl font-bold ${st === "failed" && data.stats[st] ? "text-late" : ""}`}>{data.stats[st] ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-mute">
                Average from send to delivered {secs(data.timing.to_delivered)}, to read {secs(data.timing.to_read)}. Messages to the store wait in the outbox while WhatsApp is unreachable and are
                retried with backoff; a refused message is marked failed with Meta&apos;s error.
              </p>
            </Card>
          </div>

          <Card className="mt-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
              <p className="mr-auto px-1 text-sm font-semibold">Wire log</p>
              <label className="flex items-center gap-1 text-xs text-mute">
                Store
                <select value={outlet} onChange={(e) => setOutlet(e.target.value)} className="h-8 rounded-md border border-line bg-card px-1 text-xs text-night">
                  <option value="">All stores</option>
                  {data.contacts.map((c) => (
                    <option key={c.outlet_id} value={c.outlet_id}>
                      {c.outlet_id}
                      {c.outlet_id === "OUT029" ? " (walkthrough)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {(["messages", "statuses", "problems", "all"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`h-8 rounded-md border px-2 text-xs font-medium ${filter === f ? "border-night bg-night text-white" : "border-line bg-card"}`}>
                  {f === "messages" ? "Messages and replies" : f === "statuses" ? "Status webhooks" : f === "problems" ? "Problems" : "Everything"}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-line text-sm">
              {rows.length === 0 && <li className="px-3 py-6 text-center text-mute">Nothing here yet. Publish the plan and the stores&apos; messages go out; delivery ticks are under Status webhooks.</li>}
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => toggle(r.id)} className="grid w-full grid-cols-[70px_90px_52px_1fr] items-start gap-2 px-3 py-2 text-left hover:bg-paper sm:grid-cols-[70px_110px_52px_120px_1fr_110px]">
                    <span className="font-mono text-xs text-mute">{new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="text-xs font-semibold">{r.direction === "outbound" ? `→ ${r.kind}` : `← ${r.kind}`}</span>
                    <span className={`font-mono text-xs font-bold ${tone((r.http_status ?? 0) >= 200 && (r.http_status ?? 0) < 300)}`}>{r.http_status ?? "–"}</span>
                    <span className="hidden text-xs sm:block">{r.outlet_id ?? (r.phone ? formatPhone(r.phone) : "")}</span>
                    <span className="min-w-0 truncate text-xs">
                      {r.direction === "webhook" && (
                        <span className={`mr-1 font-semibold ${tone(!!r.signature_ok)}`}>{r.signature_ok ? "signature ✓" : "signature ✗"}</span>
                      )}
                      {r.text ?? r.note}
                    </span>
                    <span className="hidden text-right text-xs capitalize sm:block">{r.wa_status ? `${r.wa_status}${r.wa_error ? " ⚠" : ""}` : ""}</span>
                  </button>
                  {open.has(r.id) && (
                    <div className="grid gap-2 px-3 pb-3 lg:grid-cols-2">
                      {r.note && <p className="text-xs text-mute lg:col-span-2">{r.note}</p>}
                      {r.wa_error && <p className="text-xs text-late lg:col-span-2">Error: {r.wa_error}</p>}
                      <pre className="max-h-72 overflow-auto rounded-md bg-night p-2 text-[11px] text-white/90">{`${r.direction === "outbound" ? "request" : "webhook body"}\n${JSON.stringify(r.request, null, 2)}`}</pre>
                      <pre className="max-h-72 overflow-auto rounded-md bg-night p-2 text-[11px] text-white/90">{r.direction === "outbound" ? `response\n${JSON.stringify(r.response, null, 2)}` : `result\n${r.note ?? ""}`}</pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <details className="mt-3 rounded-lg border border-line bg-card p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Message templates submitted to Meta ({data.templates.length})</summary>
            <p className="mt-1 text-xs text-mute">
              Outside the 24-hour customer-service window WhatsApp only allows approved templates, so every message has one. Inside it (after a store replies), messages go free-form with reply buttons.
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.templates.map((t) => (
                <div key={`${t.name}-${t.language}`} className="rounded-md border border-line p-2">
                  <p className="font-mono text-xs font-semibold">
                    {t.name} · {t.language} · {t.category}
                  </p>
                  <p className="mt-1 text-xs">{t.components.find((c) => c.type === "BODY")?.text}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.components.find((c) => c.type === "BUTTONS")?.buttons?.map((b) => (
                      <span key={b.text} className="rounded border border-line px-1.5 text-xs text-[#027eb5]">
                        {b.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </Shell>
  );
}

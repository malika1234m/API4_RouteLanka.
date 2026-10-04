"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { Btn, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

export interface Connection {
  outlet: string;
  mode: "off" | "simulator" | "cloud";
  business: string;
  connected: { phone: string; number: string; source: "seed" | "config" | "join"; since: string; by: string | null } | null;
  pending: { text: string; expires_at: string; link: string; simulator: string } | null;
}

const WA_GREEN = "#075e54";

/** The store's WhatsApp number in a line, for the deliveries screen: connected, or a link to connect. */
export function WhatsAppStatus({ outlet }: { outlet: string }) {
  const { t } = useT("store");
  const [c, setC] = useState<Connection | null>(null);
  useEffect(() => {
    let live = true;
    api<Connection>(`/whatsapp/connection?outlet=${outlet}`)
      .then((x) => live && setC(x))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [outlet]);
  if (!c) return null;
  return (
    <>
      <p className="mt-1 text-sm text-mute">
        {c.connected ? t("Connected to {p}", { p: c.connected.phone }) : t("Not connected. Updates show here in the app only.")}
      </p>
      {c.connected && c.mode !== "cloud" && (
        <a href={`/wa-sim?phone=${c.connected.number}`} target="_blank" rel="noreferrer" className="mt-2 block text-center text-xs font-semibold text-[#027eb5] underline">
          {t("See it on this store's phone (WhatsApp simulator)")}
        </a>
      )}
    </>
  );
}

/**
 * A store connects its own WhatsApp number: the app shows a one-time "JOIN <outlet> <code>" message, the store
 * sends it to the business number from its phone (QR code or link), and the webhook links that phone. The
 * phone that sends it is the one that gets the updates, so there is no number to type and nothing to verify.
 */
export function WhatsAppConnect({ outlet, onConnected }: { outlet: string; onConnected?: () => void }) {
  const { t } = useT("store");
  const [c, setC] = useState<Connection | null>(null);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const wasConnected = useRef<string | null>(null);

  // Load the store's connection, and keep looking while a code is open (the JOIN message arrives by webhook).
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api<Connection>(`/whatsapp/connection?outlet=${outlet}`)
        .then((x) => {
          if (!live) return;
          setC(x);
          if (x.pending) timer = setTimeout(load, 2500);
        })
        .catch(() => {});
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [outlet, c?.pending?.text]);

  // Tell the page when a number has just been connected, so it shows the confirmation message.
  useEffect(() => {
    const phone = c?.connected?.phone ?? null;
    if (phone && wasConnected.current !== null && phone !== wasConnected.current) onConnected?.();
    if (c) wasConnected.current = phone ?? "";
  }, [c, onConnected]);

  useEffect(() => {
    let live = true;
    if (c?.pending) void QRCode.toDataURL(c.pending.link, { margin: 1, width: 336, color: { dark: WA_GREEN } }).then((s) => live && setQr(s));
    return () => {
      live = false;
    };
  }, [c?.pending]);

  const act = async (path: "connect" | "disconnect") => {
    setErr("");
    setBusy(true);
    try {
      setC(await api<Connection>(`/whatsapp/${path}`, { outlet }));
      if (path === "disconnect") onConnected?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!c) return null;
  const sim = c.mode !== "cloud";

  return (
    <Card className="mx-auto mt-4 max-w-md p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-white" style={{ background: WA_GREEN }} aria-hidden>
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("WhatsApp updates")}</p>
          {c.connected ? (
            <>
              <p className="text-sm">
                {t("Connected to {p}", { p: c.connected.phone })}
                {c.connected.source === "seed" ? ` · ${t("demo number")}` : ""}
              </p>
              <p className="text-xs text-mute">
                {c.connected.source === "join" ? t("Connected from the phone itself{n}.", { n: c.connected.by ? `, ${t("set up by {n}", { n: c.connected.by })}` : "" }) : c.connected.source === "config" ? t("Set up by Waypoint.") : t("Every store starts with a demo number in the simulator.")}
              </p>
            </>
          ) : c.pending ? (
            <p className="text-sm">{t("Send the message below from the phone that should get the updates.")}</p>
          ) : (
            <p className="text-sm text-mute">{t("Not connected. Updates show here in the app only.")}</p>
          )}
        </div>
      </div>

      {c.pending && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing for next/image to optimise */}
          {qr && <img src={qr} alt={t("QR code that opens WhatsApp")} width={168} height={168} className="mx-auto rounded-md bg-white" />}
          <div className="space-y-2 text-sm">
            <p>{t("Scan the code with that phone, or open the link on it. WhatsApp opens with this message ready: press send.")}</p>
            <p className="rounded-md bg-paper px-3 py-2 font-cond text-lg font-bold tracking-wide">{c.pending.text}</p>
            <p className="text-xs text-mute">
              {t("To {b}. The code works for 30 minutes. Waiting for your message…", { b: c.business })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {sim ? (
              <a href={c.pending.simulator} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md px-4 font-semibold text-white" style={{ background: WA_GREEN }}>
                {t("Open WhatsApp (simulator)")}
              </a>
            ) : (
              <a href={c.pending.link} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md px-4 font-semibold text-white" style={{ background: WA_GREEN }}>
                {t("Open WhatsApp")}
              </a>
            )}
            <Btn variant="ghost" onClick={() => void act("connect")} disabled={busy}>
              {t("New code")}
            </Btn>
          </div>
          {sim && <p className="text-xs text-mute sm:col-span-2">{t("Demo: the simulator plays the store's phone. On a real phone the link opens WhatsApp.")}</p>}
        </div>
      )}

      {err && (
        <p role="alert" className="mt-2 text-sm font-semibold text-late">
          {err}
        </p>
      )}

      {!c.pending && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn variant={c.connected ? "secondary" : "primary"} onClick={() => void act("connect")} disabled={busy}>
            {c.connected ? t("Change number") : t("Connect WhatsApp")}
          </Btn>
          {c.connected && (
            <Btn variant="ghost" onClick={() => void act("disconnect")} disabled={busy}>
              {t("Disconnect")}
            </Btn>
          )}
        </div>
      )}
    </Card>
  );
}

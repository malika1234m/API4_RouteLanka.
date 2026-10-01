/**
 * WhatsApp Cloud API simulator.
 *
 *   POST /v21.0/{phone-number-id}/messages    Meta's send endpoint (bearer token, same body and answers)
 *   GET  /wa-sim/                             phones in the browser, and the wire log
 *   GET  /wa-sim/api/state                    phones and wire log as JSON (for the UI and tests)
 *   POST /wa-sim/api/tap | /text | /read      what a store does on its phone
 *   POST /wa-sim/api/replay | /forged         webhook robustness checks for judges
 *
 * Point the notifier at Meta instead (WHATSAPP_MODE=cloud, WHATSAPP_API_BASE=https://graph.facebook.com) and
 * nothing else changes: this service exists so the integration can be examined without a Meta account.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cfg, customerSends, forged, markRead, phones, replayLast, sendMessage, wire } from "./cloud";
import { PAGE } from "./page";

const PORT = Number(process.env.PORT ?? 3200);

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://sim");
  const path = url.pathname;
  try {
    const send = /^\/v\d+\.\d+\/(\d+)\/messages$/.exec(path);
    if (send && req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(await read(req));
      } catch {
        return json(res, 400, { error: { message: "(#100) Invalid JSON", type: "OAuthException", code: 100 } });
      }
      const out = sendMessage(send[1], req.headers.authorization, body);
      return json(res, out.status, out.json);
    }
    if (path === "/wa-sim" || path === "/wa-sim/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(PAGE);
    }
    if (path === "/wa-sim/api/state") {
      return json(res, 200, {
        config: { phoneNumberId: cfg.phoneNumberId, webhookUrl: cfg.webhookUrl },
        phones: [...phones.values()].sort((a, b) => (b.messages.at(-1)?.at ?? 0) - (a.messages.at(-1)?.at ?? 0)),
        wire: wire.slice(0, 150),
      });
    }
    if (req.method === "POST" && path.startsWith("/wa-sim/api/")) {
      const b = JSON.parse((await read(req)) || "{}") as { phone?: string; messageId?: string; button?: number; text?: string };
      if (path.endsWith("/tap") && b.phone && b.messageId != null && b.button != null) return json(res, 200, customerSends(b.phone, { tap: { messageId: b.messageId, button: b.button } }));
      if (path.endsWith("/text") && b.phone && b.text) return json(res, 200, customerSends(b.phone, { text: b.text.slice(0, 1000) }));
      if (path.endsWith("/read") && b.phone) return json(res, 200, (markRead(b.phone), { ok: true }));
      if (path.endsWith("/replay")) return json(res, 200, { http: await replayLast() });
      if (path.endsWith("/forged")) return json(res, 200, { http: await forged() });
    }
    if (path === "/health") return json(res, 200, { ok: true });
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, () => console.log(`[wa-sim] Cloud API simulator on :${PORT}; webhooks to ${cfg.webhookUrl}`));

/**
 * Cheaper reads for phones on a weak signal.
 *
 * - ETag on every JSON GET: a screen that refetches an unchanged view (a reconnect, a burst of events) gets
 *   `304 Not Modified` and no body.
 * - gzip for JSON bodies over 1 KB when the client accepts it: the day view shrinks about tenfold.
 * The event stream writes to the raw socket and is not touched by either.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";

export function httpCache(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    if (typeof payload !== "string" || !String(reply.getHeader("content-type") ?? "").startsWith("application/json")) return payload;
    if (req.method === "GET" && reply.statusCode === 200) {
      const tag = `W/"${createHash("sha1").update(payload).digest("base64url").slice(0, 22)}"`;
      reply.header("etag", tag);
      reply.header("cache-control", "private, no-cache");
      if (req.headers["if-none-match"] === tag) {
        reply.code(304);
        return "";
      }
    }
    if (payload.length > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
      reply.header("content-encoding", "gzip");
      reply.header("vary", "accept-encoding");
      return gzipSync(payload, { level: 6 });
    }
    return payload;
  });
}

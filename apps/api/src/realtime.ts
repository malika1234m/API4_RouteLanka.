/**
 * Realtime: every API instance binds its own exclusive queue to all domain events and pushes a small
 * "something changed" message to the browsers watching that demo day, over server-sent events.
 * Browsers then refetch the view, so the payload stays tiny and nothing is trusted from the stream.
 */
import type { FastifyReply } from "fastify";
import { config } from "./config";
import { consume, EVENTS } from "./mq";

const watchers = new Map<string, Set<FastifyReply>>();

export function watch(workspaceId: string, reply: FastifyReply) {
  const set = watchers.get(workspaceId) ?? new Set();
  set.add(reply);
  watchers.set(workspaceId, set);
  return () => {
    set.delete(reply);
    if (!set.size) watchers.delete(workspaceId);
  };
}

export function broadcast(workspaceId: string, data: unknown) {
  const line = `event: change\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of watchers.get(workspaceId) ?? []) r.raw.write(line);
}

export async function startRealtime() {
  await consume({
    queue: `realtime.${config.instanceId}.${process.pid}`,
    exclusive: true,
    bind: [{ exchange: EVENTS, key: "#" }],
    onMessage: async (msg) => {
      const e = JSON.parse(msg.content.toString()) as { workspace_id: string; type: string; seq: string; text: string; role?: string; actor_role: string; kind: string; open: boolean; order_ref: string | null; at: string; id: string };
      broadcast(e.workspace_id, { id: e.id, type: e.type, seq: e.seq, at: e.at, text: e.text, role: e.actor_role, kind: e.kind, open: e.open, ref: e.order_ref });
    },
  });
  // Keep proxies from closing idle streams.
  setInterval(() => {
    for (const set of watchers.values()) for (const r of set) r.raw.write(": ping\n\n");
  }, 20000);
}

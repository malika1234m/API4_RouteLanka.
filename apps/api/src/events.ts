import type { FeedItem, Role } from "@routelanka/domain";
import type { Tx } from "./db";

export interface NewEvent {
  type: string;
  role: Role;
  text: string;
  kind?: FeedItem["kind"];
  ref?: string;
  open?: boolean;
  payload?: Record<string, unknown>;
  inFeed?: boolean;
}

/**
 * Append a domain event in the caller's transaction. Because it commits together with the state change,
 * the event is never lost and never describes a change that didn't happen (the transactional outbox).
 */
export async function appendEvent(tx: Tx, workspaceId: string, at: string, e: NewEvent): Promise<string> {
  const [r] = await tx<{ id: string }[]>`
    INSERT INTO events (workspace_id, type, actor_role, order_ref, text, kind, open, payload, at, in_feed)
    VALUES (${workspaceId}, ${e.type}, ${e.role}, ${e.ref ?? null}, ${e.text}, ${e.kind ?? "info"}, ${e.open ?? false},
            ${tx.json((e.payload ?? {}) as never)}, ${at}, ${e.inFeed ?? true})
    RETURNING id`;
  return r.id;
}

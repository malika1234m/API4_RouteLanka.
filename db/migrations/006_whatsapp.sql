-- WhatsApp Business Platform: who to message, what was sent, and what came back.

-- Each outlet's WhatsApp number (digits only, as the Cloud API uses them). The seed gives every outlet a demo
-- number; `live` marks numbers a real deployment may message (a Meta test number can reach up to 5 verified ones).
CREATE TABLE outlet_contacts (
  outlet_id        text PRIMARY KEY REFERENCES outlets ON DELETE CASCADE,
  phone            text NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{8,15}$'),
  live             boolean NOT NULL DEFAULT false,
  opted_in_at      timestamptz NOT NULL DEFAULT now(),
  -- The store's last message to us: free-form replies are allowed for 24 hours after it.
  last_inbound_at  timestamptz
);

-- Delivery of each store message. `local` = shown in the app only (the store's own replies, history);
-- `pending` -> `sent` -> `delivered` -> `read`, or `failed` / `skipped`.
ALTER TABLE messages
  ADD COLUMN wa_status       text NOT NULL DEFAULT 'local' CHECK (wa_status IN ('local', 'pending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  ADD COLUMN wa_id           text,
  ADD COLUMN wa_kind         text,
  ADD COLUMN wa_attempts     int  NOT NULL DEFAULT 0,
  ADD COLUMN wa_next_attempt timestamptz,
  ADD COLUMN wa_error        text,
  ADD COLUMN wa_sent_at      timestamptz,
  ADD COLUMN wa_status_at    timestamptz;
CREATE UNIQUE INDEX messages_by_wa_id ON messages (wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX messages_to_send ON messages (created_at) WHERE wa_status = 'pending';

-- Every request to the Cloud API and every webhook from it, as sent and received (tokens never stored).
CREATE TABLE wa_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  workspace_id  uuid REFERENCES workspaces ON DELETE CASCADE,
  message_id    uuid REFERENCES messages ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('outbound', 'webhook')),
  kind          text NOT NULL,
  http_status   int,
  signature_ok  boolean,
  phone         text,
  request       jsonb,
  response      jsonb,
  note          text
);
CREATE INDEX wa_log_recent ON wa_log (id DESC);
CREATE INDEX wa_log_by_day ON wa_log (workspace_id, id DESC);

-- Webhook deliveries already applied (Meta retries until it gets a 200, so the same message can arrive twice).
CREATE TABLE wa_inbound (
  wamid  text PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now()
);

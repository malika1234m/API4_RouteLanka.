-- Stores connect their own WhatsApp number. The store manager asks for a one-time code in the app, then sends
-- "JOIN <outlet> <code>" to the business number from their phone. That message proves the phone is theirs and is
-- their opt-in; the webhook links the number. "STOP" from the phone disconnects it.

-- How a number came to be linked: the seed's demo numbers, WHATSAPP_LIVE_NUMBERS, or the store's own JOIN message.
ALTER TABLE outlet_contacts ADD COLUMN source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'config', 'join'));
ALTER TABLE outlet_contacts ADD COLUMN connected_by uuid REFERENCES users ON DELETE SET NULL;

-- One open code per store. It expires, and is used once.
CREATE TABLE wa_join_codes (
  outlet_id   text PRIMARY KEY REFERENCES outlets ON DELETE CASCADE,
  code        text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  created_by  uuid REFERENCES users ON DELETE SET NULL,
  -- The demo day the store manager was in: the confirmation appears in that day's messages.
  workspace_id uuid REFERENCES workspaces ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0
);

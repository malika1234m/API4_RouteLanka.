-- Outbox plumbing.

-- Some events only move state for other screens (a phone losing signal) and should not appear in the
-- activity feed.
ALTER TABLE events ADD COLUMN in_feed boolean NOT NULL DEFAULT true;

-- When a planning request was handed to RabbitMQ.
ALTER TABLE plan_jobs ADD COLUMN dispatched_at timestamptz;

-- Wake the outbox relay as soon as something is written, instead of waiting for its next poll.
CREATE FUNCTION notify_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox', TG_TABLE_NAME);
  RETURN NULL;
END;
$$;

CREATE TRIGGER events_outbox AFTER INSERT ON events FOR EACH STATEMENT EXECUTE FUNCTION notify_outbox();
CREATE TRIGGER plan_jobs_outbox AFTER INSERT ON plan_jobs FOR EACH STATEMENT EXECUTE FUNCTION notify_outbox();

-- Lookups the API makes on every view and the housekeeping on every new day.
CREATE INDEX IF NOT EXISTS plan_jobs_by_day ON plan_jobs (workspace_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS fleet_actions_by_day ON fleet_actions (workspace_id, at);
CREATE INDEX IF NOT EXISTS workspaces_by_age ON workspaces (created_at) WHERE NOT is_default AND NOT is_template;

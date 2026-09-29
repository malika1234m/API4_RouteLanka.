-- RouteLanka schema. Reference data is shared; everything that changes during a delivery day is
-- scoped to a demo day (workspace), so judges walking through the system don't collide.

-- ───────────────────────── Reference data (from the shared datasets) ─────────────────────────

CREATE TABLE outlets (
  outlet_id          text PRIMARY KEY,
  brand              text NOT NULL CHECK (brand IN ('Fresh', 'Style', 'Tech')),
  district           text NOT NULL,
  depot              text NOT NULL CHECK (depot IN ('Peliyagoda', 'Kandy')),
  dock_type          text NOT NULL CHECK (dock_type IN ('rear_dock', 'street', 'mall_bay')),
  parking_constraint text NOT NULL CHECK (parking_constraint IN ('normal', 'van_only', 'mall_dock')),
  mall_window        text NOT NULL DEFAULT '',
  window_open_time   text NOT NULL,
  window_close_time  text NOT NULL
);

CREATE TABLE vehicles (
  vehicle_id          text PRIMARY KEY,
  type                text    NOT NULL CHECK (type IN ('truck', 'van')),
  temp                text    NOT NULL CHECK (temp IN ('reefer', 'ambient')),
  weight_cap_kg       numeric NOT NULL,
  volume_cap_m3       numeric NOT NULL,
  fuel_type           text    NOT NULL,
  km_per_l            numeric NOT NULL,
  weekly_fuel_quota_l numeric NOT NULL,
  depot               text    NOT NULL
);

CREATE TABLE districts (
  district                       text PRIMARY KEY,
  depot                          text    NOT NULL,
  road_class                     text    NOT NULL,
  free_flow_kmh                  numeric NOT NULL,
  depot_to_district_km           numeric NOT NULL,
  depot_to_district_freeflow_min numeric NOT NULL,
  inter_stop_km                  numeric NOT NULL,
  inter_stop_freeflow_min        numeric NOT NULL
);

CREATE TABLE service_allowance (
  brand     text    NOT NULL,
  dock_type text    NOT NULL,
  minutes   numeric NOT NULL,
  PRIMARY KEY (brand, dock_type)
);

CREATE TABLE calendar (
  date          date PRIMARY KEY,
  dow           smallint NOT NULL,
  iso_year      smallint NOT NULL,
  iso_week      smallint NOT NULL,
  is_payday     boolean  NOT NULL,
  festival      text     NOT NULL DEFAULT '',
  festival_ramp numeric  NOT NULL,
  is_holiday    boolean  NOT NULL,
  monsoon       boolean  NOT NULL,
  is_operating  boolean  NOT NULL
);

CREATE TABLE road_conditions (
  district         text     NOT NULL,
  date             date     NOT NULL,
  disruption_index smallint NOT NULL,
  PRIMARY KEY (district, date)
);

-- Derived from the history at seed time: an outlet's recent delivery record, and the 10-week outlook.
CREATE TABLE outlet_history (
  outlet_id text PRIMARY KEY REFERENCES outlets,
  summary   jsonb NOT NULL
);

CREATE TABLE capacity_outlook (
  depot            text     NOT NULL,
  iso_year         smallint NOT NULL,
  iso_week         smallint NOT NULL,
  total            numeric  NOT NULL,
  chilled          numeric  NOT NULL,
  chilled_capacity numeric  NOT NULL,
  operating_days   smallint NOT NULL,
  festival         text     NOT NULL DEFAULT '',
  paydays          smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (depot, iso_year, iso_week)
);

-- Parameters the planning engine uses for predictions (service time, traffic, lateness),
-- measured from the history at seed time.
CREATE TABLE engine_params (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- ───────────────────────── People ─────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('dispatcher', 'loader', 'driver', 'store')),
  display_name  text NOT NULL,
  depot         text,
  outlet_id     text REFERENCES outlets,
  vehicle_id    text REFERENCES vehicles,
  trip_id       smallint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Demo days ─────────────────────────

CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  service_date    date        NOT NULL,
  is_default      boolean     NOT NULL DEFAULT false,
  -- The seeded starting state. Every demo day, including the default one, is a copy of it.
  is_template     boolean     NOT NULL DEFAULT false,
  -- The day runs on a demo clock: it reads 03:00 at clock_start and moves clock_speed x real time.
  clock_start     timestamptz NOT NULL DEFAULT now(),
  clock_speed     smallint    NOT NULL DEFAULT 15,
  published       boolean     NOT NULL DEFAULT false,
  plan_version    integer     NOT NULL DEFAULT 1,
  plan_changed_at text,
  delay_told_at   text,
  meta            jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_default_workspace ON workspaces (is_default) WHERE is_default;
CREATE UNIQUE INDEX one_template_workspace ON workspaces (is_template) WHERE is_template;

-- Each user's language, per demo day (field staff pick Sinhala, Tamil or English).
CREATE TABLE user_prefs (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  role         text NOT NULL,
  lang         text NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'si', 'ta')),
  PRIMARY KEY (workspace_id, role)
);

-- Vehicle availability and fuel already used this week, for the day.
CREATE TABLE vehicle_day (
  workspace_id uuid    NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  vehicle_id   text    NOT NULL REFERENCES vehicles,
  status       text    NOT NULL CHECK (status IN ('available', 'in_workshop')),
  fuel_used_l  numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, vehicle_id)
);

-- Orders for the run. Seeded from the datasets, or placed by a store manager.
CREATE TABLE orders (
  workspace_id           uuid     NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  order_ref              text     NOT NULL,
  outlet_id              text     NOT NULL REFERENCES outlets,
  brand                  text     NOT NULL,
  district               text     NOT NULL,
  depot                  text     NOT NULL,
  temp_requirement       text     NOT NULL CHECK (temp_requirement IN ('chilled', 'ambient')),
  order_units            integer  NOT NULL CHECK (order_units > 0),
  order_weight_kg        numeric  NOT NULL CHECK (order_weight_kg > 0),
  order_volume_m3        numeric  NOT NULL CHECK (order_volume_m3 > 0),
  deferred_yesterday     smallint NOT NULL DEFAULT 0,
  days_since_last_served smallint NOT NULL DEFAULT 1,
  run_date               date     NOT NULL,
  source                 text     NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'store')),
  placed_at              text,
  PRIMARY KEY (workspace_id, order_ref)
);
CREATE INDEX orders_by_outlet ON orders (workspace_id, outlet_id);

-- The working plan: one row per order for the run.
CREATE TABLE assignments (
  workspace_id     uuid     NOT NULL,
  order_ref        text     NOT NULL,
  decision         text     NOT NULL CHECK (decision IN ('served', 'deferred')),
  reason           text,
  vehicle_id       text     REFERENCES vehicles,
  trip_id          smallint CHECK (trip_id IN (1, 2)),
  stop_seq         smallint,
  plan_arrival     text,
  pred_arrival     text,
  pred_window      text,
  pred_service_min numeric,
  pred_late_prob   numeric,
  priority         numeric  NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, order_ref),
  FOREIGN KEY (workspace_id, order_ref) REFERENCES orders ON DELETE CASCADE,
  CHECK (decision = 'deferred' OR (vehicle_id IS NOT NULL AND trip_id IS NOT NULL))
);

CREATE TABLE trips (
  workspace_id uuid     NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  vehicle_id   text     NOT NULL REFERENCES vehicles,
  trip_id      smallint NOT NULL CHECK (trip_id IN (1, 2)),
  brand        text     NOT NULL,
  district     text     NOT NULL,
  depot        text     NOT NULL,
  depart       text     NOT NULL,
  minutes      numeric  NOT NULL,
  km           numeric  NOT NULL,
  fuel_l       numeric  NOT NULL,
  ready_at     text,
  departed_at  text,
  PRIMARY KEY (workspace_id, vehicle_id, trip_id)
);

-- What has happened to each order: loading, delivery, proof and receipt.
CREATE TABLE order_progress (
  workspace_id      uuid    NOT NULL,
  order_ref         text    NOT NULL,
  stage             text    NOT NULL DEFAULT 'ordered'
                      CHECK (stage IN ('ordered', 'planned', 'loaded', 'on_road', 'delivered', 'received')),
  deferred          boolean NOT NULL DEFAULT false,
  handover_code     text,
  load_flag         jsonb,
  load_decision     text CHECK (load_decision IN ('send_short', 'hold', 'defer_rest')),
  arrived_at        text,
  delivered_at      text,
  delivered_units   integer,
  exception         text,
  pod               jsonb,
  recorded_offline  boolean NOT NULL DEFAULT false,
  synced_at         text,
  receipt           jsonb,
  reassigned_to     text REFERENCES vehicles,
  deferred_en_route text CHECK (deferred_en_route IN ('road', 'store')),
  delay_choice      text CHECK (delay_choice IN ('late', 'move', 'defer')),
  ack_at            text,
  store_reply       jsonb,
  PRIMARY KEY (workspace_id, order_ref),
  FOREIGN KEY (workspace_id, order_ref) REFERENCES orders ON DELETE CASCADE
);

-- The driver's phone as the system last heard from it.
CREATE TABLE driver_status (
  workspace_id      uuid    NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  vehicle_id        text    NOT NULL REFERENCES vehicles,
  online            boolean NOT NULL DEFAULT true,
  offline_since     text,
  last_contact      text,
  last_contact_stop text,
  delay             jsonb,
  last_sync         jsonb,
  conflicts         jsonb   NOT NULL DEFAULT '[]',
  PRIMARY KEY (workspace_id, vehicle_id)
);

-- Records made on a driver's phone. The client-generated id makes a re-sent sync idempotent.
CREATE TABLE field_records (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  vehicle_id   text NOT NULL,
  order_ref    text NOT NULL,
  type         text NOT NULL CHECK (type IN ('arrived', 'delivered')),
  recorded_at  text NOT NULL,
  payload      jsonb,
  offline      boolean NOT NULL DEFAULT false,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Domain events: the audit trail, the activity feed and the transactional outbox in one table.
CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigserial UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  type         text NOT NULL,
  actor_role   text NOT NULL,
  order_ref    text,
  text         text NOT NULL,
  kind         text NOT NULL DEFAULT 'info' CHECK (kind IN ('info', 'issue', 'sync', 'decision')),
  open         boolean NOT NULL DEFAULT false,
  payload      jsonb NOT NULL DEFAULT '{}',
  at           text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX events_feed ON events (workspace_id, seq DESC);
CREATE INDEX events_unpublished ON events (seq) WHERE published_at IS NULL;

-- Store and driver messages written by the notifier (WhatsApp and SMS, simulated gateway).
-- Text is stored as a template key plus values, so it can be shown in the reader's language.
CREATE TABLE messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  source_event uuid NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  outlet_id    text REFERENCES outlets,
  order_ref    text,
  direction    text NOT NULL CHECK (direction IN ('in', 'out')),
  template     text NOT NULL,
  vars         jsonb NOT NULL DEFAULT '{}',
  replies      jsonb,
  day          text NOT NULL DEFAULT 'Today',
  at           text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_event, order_ref, template)
);
CREATE INDEX messages_by_outlet ON messages (workspace_id, outlet_id, created_at);

-- Consumer-side idempotency: a redelivered event is processed once per consumer.
CREATE TABLE processed_messages (
  consumer     text        NOT NULL,
  event_id     uuid        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- Plan versions as published: who published what, when.
CREATE TABLE plan_versions (
  workspace_id uuid        NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  version      integer     NOT NULL,
  published_at text        NOT NULL,
  served       integer     NOT NULL,
  deferred     integer     NOT NULL,
  snapshot     jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, version)
);

-- Requests to the planning engine (a queue worker), and their results.
CREATE TABLE plan_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  summary      jsonb,
  error        text
);

CREATE TABLE fleet_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid    NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  kind         text    NOT NULL CHECK (kind IN ('repair', 'hire')),
  vehicle_id   text,
  district     text,
  m3           numeric,
  cost         numeric,
  at           text    NOT NULL,
  note         text    NOT NULL
);

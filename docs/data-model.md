# RouteLanka data model

PostgreSQL 16. The schema lives in `db/migrations/` (001 to 008) and is applied in order by
`services/engine/routelanka_engine/migrate.py`, which takes an advisory lock and records each file in
`schema_migrations`.

There are four groups of table:

* **Reference data:** loaded once from the competition datasets and shared by every demo day.
* **People and access:** staff accounts, each tied to the work it covers.
* **Day data:** one delivery night, keyed by `workspace_id`. A judge pressing *Start a new demo day* gets a fresh
  copy, so several people can run the walkthrough at once without disturbing each other.
* **Messaging and audit:** the event log (which is also the transactional outbox), store messages, WhatsApp, and
  consumer bookkeeping.

The diagrams below are also exported as images in [`diagrams/`](diagrams/) for viewers that don't render Mermaid.

## Entity relationship overview

Solid lines are foreign keys in the database. Dotted lines are links the application keeps (by matching columns)
without a foreign key: a trip is identified by `(workspace_id, vehicle_id, trip_id)` and a message by the event
that caused it.

```mermaid
erDiagram
  WORKSPACES ||--o{ ORDERS : "holds"
  WORKSPACES ||--o{ TRIPS : "holds"
  WORKSPACES ||--o{ VEHICLE_DAY : "holds"
  WORKSPACES ||--o{ DRIVER_STATUS : "holds"
  WORKSPACES ||--o{ EVENTS : "logs"
  WORKSPACES ||--o{ MESSAGES : "holds"
  WORKSPACES ||--o{ PLAN_JOBS : "queues"
  WORKSPACES ||--o{ PLAN_VERSIONS : "publishes"
  WORKSPACES ||--o{ FIELD_RECORDS : "receives"
  WORKSPACES ||--o{ FLEET_ACTIONS : "records"
  OUTLETS ||--o{ ORDERS : "places"
  ORDERS ||--|| ASSIGNMENTS : "planned as"
  ORDERS ||--|| ORDER_PROGRESS : "tracked as"
  VEHICLES ||--o{ ASSIGNMENTS : "carries"
  VEHICLES ||--o{ TRIPS : "runs"
  VEHICLES ||--o{ VEHICLE_DAY : "status per day"
  VEHICLES ||--o{ DRIVER_STATUS : "phone per day"
  TRIPS |o..o{ ASSIGNMENTS : "stops (vehicle_id, trip_id)"
  OUTLETS ||--o| OUTLET_HISTORY : "measured"
  OUTLETS ||--o| OUTLET_CONTACTS : "WhatsApp number"
  OUTLETS ||--o| WA_JOIN_CODES : "open connect code"
  OUTLETS ||--o{ MESSAGES : "receives"
  USERS }o--o| OUTLETS : "store manager"
  USERS }o--o| VEHICLES : "driver"
  USERS |o--o{ USERS : "added by"
  USERS |o--o{ OUTLET_CONTACTS : "connected by"
  EVENTS |o..o{ MESSAGES : "source_event"
  MESSAGES ||--o{ WA_LOG : "API calls"
```

## Reference data and people

```mermaid
erDiagram
  OUTLETS {
    text outlet_id PK
    text brand "Fresh, Style, Tech"
    text district
    text depot "Peliyagoda or Kandy"
    text dock_type
    text parking_constraint "van_only, mall_dock, none"
    text mall_window
    text window_open_time
    text window_close_time
  }
  VEHICLES {
    text vehicle_id PK
    text type "truck or van"
    text temp "reefer or ambient"
    numeric weight_cap_kg
    numeric volume_cap_m3
    numeric km_per_l
    numeric weekly_fuel_quota_l
    text depot "home depot"
  }
  DISTRICTS {
    text district PK
    text depot
    text road_class
    numeric depot_to_district_km
    numeric inter_stop_km
  }
  CALENDAR {
    date date PK
    int iso_week
    bool is_payday
    text festival
    bool monsoon
    bool is_operating
  }
  USERS {
    uuid id PK
    text username UK
    text password_hash "bcrypt"
    text role "dispatcher, loader, driver, store"
    text display_name
    text lang "en, si, ta"
    text depot "loader, dispatcher"
    text outlet_id FK "store manager: one store"
    text district "area manager: every store in it"
    text vehicle_id FK "driver: one active driver per vehicle"
    bool active
    bool is_demo "the four walkthrough accounts"
    uuid created_by FK
  }
  OUTLET_HISTORY {
    text outlet_id PK, FK
    jsonb summary "on-time record from the route history"
  }
  USERS }o--o| OUTLETS : "store manager"
  USERS }o--o| VEHICLES : "driver"
  USERS |o--o{ USERS : "added by"
  OUTLETS ||--o| OUTLET_HISTORY : "measured"
```

## One delivery night (day data)

```mermaid
erDiagram
  WORKSPACES {
    uuid id PK
    text name
    date service_date
    bool is_template
    bool is_default
    bool published
    int plan_version
    jsonb meta "calendar facts and demo personas"
  }
  ORDERS {
    uuid workspace_id PK, FK
    text order_ref PK
    text outlet_id FK
    text temp_requirement "chilled or ambient"
    int order_units
    numeric order_weight_kg
    numeric order_volume_m3
    date run_date
    bool deferred_yesterday
  }
  ASSIGNMENTS {
    uuid workspace_id PK, FK
    text order_ref PK, FK
    text decision "served or deferred"
    text reason "deferral reason code"
    text vehicle_id FK
    int trip_id
    int stop_seq
    text pred_window
    numeric pred_late_prob
  }
  TRIPS {
    uuid workspace_id PK, FK
    text vehicle_id PK, FK
    int trip_id PK
    text depart
    numeric km
    numeric fuel_l
    text ready_at "loader: checked"
    text departed_at "loader: released"
  }
  ORDER_PROGRESS {
    uuid workspace_id PK, FK
    text order_ref PK, FK
    text stage "planned, loaded, on_road, delivered, received"
    jsonb load_flag
    text handover_code
    text delivered_at
    jsonb pod "proof of delivery"
    bool recorded_offline
    jsonb receipt
    text reassigned_to FK
  }
  VEHICLE_DAY {
    uuid workspace_id PK, FK
    text vehicle_id PK, FK
    text status "available or in_workshop"
    numeric fuel_used_l
  }
  DRIVER_STATUS {
    uuid workspace_id PK, FK
    text vehicle_id PK, FK
    bool online
    text last_contact
    jsonb delay "reported delay, and when the dispatcher decided"
    jsonb last_sync
  }
  FIELD_RECORDS {
    uuid id PK "made on the phone"
    uuid workspace_id FK
    text vehicle_id
    text order_ref
    text type "arrived or delivered"
    text recorded_at
    bool offline
  }
  WORKSPACES ||--o{ ORDERS : "holds"
  WORKSPACES ||--o{ TRIPS : "holds"
  WORKSPACES ||--o{ VEHICLE_DAY : "holds"
  WORKSPACES ||--o{ DRIVER_STATUS : "holds"
  WORKSPACES ||--o{ FIELD_RECORDS : "receives"
  ORDERS ||--|| ASSIGNMENTS : "planned as"
  ORDERS ||--|| ORDER_PROGRESS : "tracked as"
  TRIPS |o..o{ ASSIGNMENTS : "stops"
```

## Messaging, WhatsApp and audit

```mermaid
erDiagram
  EVENTS {
    uuid id PK
    bigint seq "order of events"
    uuid workspace_id FK
    text type "e.g. load.flagged"
    text actor_role
    text order_ref
    jsonb payload
    bool open "needs a decision"
    timestamptz published_at "confirmed by RabbitMQ"
  }
  MESSAGES {
    uuid id PK
    uuid workspace_id FK
    uuid source_event "unique with order_ref and template"
    text outlet_id FK
    text template "English text, also the translation key"
    jsonb vars
    jsonb replies "reply buttons"
    text wa_status "pending, sent, delivered, read, failed"
    text wa_id
  }
  OUTLET_CONTACTS {
    text outlet_id PK, FK
    text phone UK
    bool live
    text source "seed, config or join"
    uuid connected_by FK
    timestamptz opted_in_at
    timestamptz last_inbound_at "opens the 24-hour window"
  }
  WA_JOIN_CODES {
    text outlet_id PK, FK
    text code "6 digits, used once"
    uuid created_by FK
    uuid workspace_id FK
    timestamptz expires_at "30 minutes"
    int attempts "void after 5 wrong"
  }
  WA_LOG {
    bigint id PK
    uuid message_id FK
    text direction "outbound or webhook"
    int http_status
    bool signature_ok
    jsonb request
    jsonb response
  }
  WA_INBOUND {
    text wamid PK "applied once"
  }
  PROCESSED_MESSAGES {
    text consumer PK
    uuid event_id PK
  }
  EVENTS |o..o{ MESSAGES : "source_event"
  MESSAGES ||--o{ WA_LOG : "API calls"
```

## Tables

### Reference data (from the datasets)

| Table | Key | Contents |
|---|---|---|
| `outlets` | `outlet_id` | brand, district, depot, dock type, parking constraint, mall window, delivery window |
| `vehicles` | `vehicle_id` | type, temperature, weight and volume capacity, km/l, weekly fuel quota, home depot |
| `districts` | `district` | depot, road class, depot-to-district and inter-stop km and free-flow minutes |
| `service_allowance` | `brand, dock_type` | the dispatcher's handling allowance per stop |
| `calendar` | `date` | weekday, ISO week, payday, festival and ramp, holiday, monsoon, operating day |
| `road_conditions` | `district, date` | disruption index |
| `outlet_history` | `outlet_id` | the outlet's recent delivery record, measured from the route records at seed time (JSON summary) |
| `capacity_outlook` | `depot, iso_year, iso_week` | weekly total and chilled demand against chilled capacity, with operating days, festival and paydays (the *Capacity outlook* screen) |
| `engine_params` | `key` | parameters for the engine's predictions (service time, traffic, lateness), measured from the history at seed time (JSON) |

### People and access

| Table | Key | Contents |
|---|---|---|
| `users` | `id`, unique `username` | bcrypt password hash, role, display name, language (it follows the person, on every device and demo day), `active`, `is_demo`, who added them, and the work the account covers: a **depot** (loader, dispatcher), a **store** (`outlet_id`) or every store in a **district** (area manager), or a **vehicle** (driver). A check constraint requires a store or district for store managers and a vehicle for drivers; a partial unique index allows one active driver per vehicle |

The API reloads the account on every request, so a deactivated account or a changed scope applies at once.

### Day data (per `workspace_id`)

| Table | Key | Contents |
|---|---|---|
| `workspaces` | `id` | one demo day: name, service date, demo clock (`clock_start`, `clock_speed`), `published`, `plan_version`, `meta`. One row is the template (`is_template`), one is the default (`is_default`) |
| `vehicle_day` | `workspace_id, vehicle_id` | status that day (available / in workshop), fuel used this week |
| `orders` | `workspace_id, order_ref` | the order: outlet, brand, temperature, units, kg, m³, run date, whether skipped yesterday, days since last served |
| `assignments` | `workspace_id, order_ref` | the plan: served/deferred, reason code, vehicle, trip, stop sequence, planned and predicted arrival, predicted service minutes and late probability, priority |
| `trips` | `workspace_id, vehicle_id, trip_id` | brand, district, departure, minutes, km, fuel, `ready_at` (loaded and checked), `departed_at` (released by the loader) |
| `order_progress` | `workspace_id, order_ref` | the night as it happens: stage, loader flag and decision, handover code, arrival, delivery, units, proof of delivery, offline flag, sync time, store receipt, reassignment, delay choice, store reply |
| `driver_status` | `workspace_id, vehicle_id` | one row per vehicle with a driver's phone: online or not, last report, delay report (and when the dispatcher decided it), last sync result, conflicts |
| `field_records` | `id` (client UUID) | every record a driver's phone sent, so replaying a sync is harmless (idempotent) |
| `plan_versions` | `workspace_id, version` | snapshot of each published plan |
| `plan_jobs` | `id` | planning requests to the engine: status, `dispatched_at`, summary, error |
| `fleet_actions` | `id` | repair and hire decisions from the *Fleet* screen |

### Messaging and audit

| Table | Key | Contents |
|---|---|---|
| `events` | `id`, ordered by `seq` | **every** state change: `type` (e.g. `load.flagged`), actor role, order, text for the feed, `payload`, demo time, `in_feed`, `open` (needs a decision). Written in the same transaction as the change. `published_at` is set once the relay has confirmed it with RabbitMQ (transactional outbox). An insert trigger sends `pg_notify('outbox')` so the relay wakes at once |
| `messages` | `id`, unique `(source_event, order_ref, template)` | store WhatsApp and driver SMS messages: an English template (also the translation key) plus values and reply buttons. The unique key makes a redelivered event harmless. It is also the WhatsApp outbox: `wa_status` (pending → sent → delivered → read, or failed/skipped), `wa_id`, attempts and errors |
| `outlet_contacts` | `outlet_id`, unique `phone` | each outlet's WhatsApp number; how it was linked (`seed` demo number, `config` from `WHATSAPP_LIVE_NUMBERS`, or `join` from the store's own phone) and by whom; opt-in time; the store's last message (opens the 24-hour window) |
| `wa_join_codes` | `outlet_id` | the store's open *Connect WhatsApp* code: 6 digits, the demo day it was asked in, expiry (30 minutes), wrong attempts (void after 5) |
| `wa_log` | `id` | every WhatsApp Cloud API request and webhook, as sent and received, with HTTP status and signature result (never the token) |
| `wa_inbound` | `wamid` | incoming WhatsApp messages already applied (Meta retries webhooks) |
| `processed_messages` | `consumer, event_id` | which consumer has handled which event or job, so at-least-once delivery from RabbitMQ never applies anything twice |

## Rules the schema enforces

* Foreign keys tie every order, plan row and progress row to its day; deleting a day cascades.
* Composite primary keys keep a stop on exactly one plan row and one progress row.
* Partial unique indexes allow only one template day, one default day, and one active driver per vehicle.
* A check constraint ties each store manager to a store or a district, and each driver to a vehicle.
* Operating rules (capacity, trip time, reefer, van-only, two trips, home depot, fuel quota) are checked in code
  before any write: in `packages/domain/src/rules.ts` for the API and web app, and in `services/engine` for the
  engine. The same rules are unit-tested against the booklet's worked examples, and the engine is also tested with
  `check_allocation.py`.
* The flow order is checked in code too: a trip is marked ready only when every order is loaded, and a driver can
  record an arrival or delivery only after the loader has released the truck.

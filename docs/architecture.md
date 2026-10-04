# RouteLanka architecture

RouteLanka is one system used by four roles. Every role reads and writes one shared record, and
every change is published as a domain event so the other roles hear about it straight away. This is
the "relay" from the Designathon design, implemented as an event-driven service architecture.

## Components

```mermaid
flowchart TB
  WEB["<b>Web app</b> (Next.js)<br/>dispatcher · loader · driver · store<br/>service worker + IndexedDB outbox"]
  API["<b>API service</b> (Fastify, TypeScript)<br/>auth: accounts, JWT cookie, role and scope guard<br/>command handlers (shared operating rules) · queries<br/>realtime (server-sent events) · outbox relay"]
  WA["<b>WhatsApp Cloud API</b><br/>Meta, or the bundled simulator"]
  MQ{{"<b>RabbitMQ</b><br/>routelanka.events (topic)<br/>routelanka.commands (direct)<br/>dead-letter exchange"}}
  DB[("<b>PostgreSQL</b><br/>reference data · orders · plans<br/>progress · events (outbox)")]
  SEED["<b>Seed job</b> (Python, one-shot)<br/>migrations + datasets"]
  ENGINE["<b>Planning engine</b> (Python worker)<br/>allocation · stop order · ETAs"]
  NOTIFY["<b>Notifier</b> (TypeScript worker)<br/>WhatsApp and SMS messages"]

  WEB -- "HTTPS: commands, queries, /sync" --> API
  API -- "live updates (SSE)" --> WEB
  WA -- "signed webhooks" --> API
  API -- "state + event,<br/>one transaction" --> DB
  SEED --> DB
  API <-- "publish events /<br/>events for live updates" --> MQ
  MQ -- "plan.propose" --> ENGINE
  ENGINE -- "plan.proposed" --> MQ
  MQ -- "domain events" --> NOTIFY
  ENGINE -- "plan" --> DB
  NOTIFY -- "messages" --> DB
  NOTIFY -- "send" --> WA
```

| Component | Responsibility | Why it is separate |
|---|---|---|
| **Web app** (`apps/web`) | The screens from the Designathon design, for all four roles. Works offline on the driver's phone. | UI only; holds no business state of its own. |
| **API service** (`apps/api`) | Sign-in, role checks, every command (publish, load, deliver, …) and every query. Writes state and the matching event in one transaction. | The single place that enforces the operating rules and owns the database. |
| **Planning engine** (`services/engine`) | Proposes the allocation: orders → vehicles and trips, deferrals with reasons, stop order, predicted arrival. | CPU-bound and written in Python (the same engine validated with the organisers' `check_allocation.py`). Runs as a queue worker so a slow plan never blocks the API. |
| **Notifier** (`services/notifier`) | Turns domain events into store messages (WhatsApp) and driver SMS, in each person's language. | Messaging is a side effect. If it is slow or down, planning and delivery keep working; messages catch up. |
| **WhatsApp** (`services/notifier/src/whatsapp.ts`, `apps/api/src/whatsapp.ts`, `services/wa-sim`) | Sends store messages through the WhatsApp Business Platform. Signed webhooks bring back delivery ticks and one-tap replies, which run as normal commands. A Cloud API simulator plays Meta for the demo. | The messages table is an outbox, so WhatsApp being slow or down never blocks planning; the webhook is a public endpoint and is guarded by signatures, de-duplication and per-store scope. |
| **Seed job** (`services/engine`, `seed` command) | Loads the shared datasets and one realistic delivery day on a fresh install. | Runs once at start-up, then exits. |
| **PostgreSQL** | The shared record. | |
| **RabbitMQ** | Carries commands to workers and fans events out to every consumer. | Decouples the roles: the loader's flag reaches the dispatcher, the notifier and every open screen without the API calling each of them. |

## The night, end to end

Planning, loading, delivery and receipt happen in a fixed order, and the API enforces it: a trip can be marked
ready only when every order is loaded, and a driver can record a stop only after the loader has released the truck.

```mermaid
sequenceDiagram
  autonumber
  actor D as Dispatcher
  participant API as API + PostgreSQL
  participant E as Planning engine
  actor L as Loader
  actor R as Driver (phone)
  actor S as Store (app or WhatsApp)
  D->>API: Re-plan
  API->>E: plan.propose (RabbitMQ)
  E-->>API: allocation, deferrals with reasons, stop order, ETAs
  D->>API: Publish plan
  API-->>S: arrival window and handover code (deferred stores: why, and the next run)
  API-->>R: run downloads to the phone (works without signal from here)
  L->>API: load each order, flag shortfalls
  D->>API: decide a shortfall (send short / hold / defer the rest)
  L->>API: Mark ready, then Release
  Note over API,R: stops unlock only after release
  R->>API: arrived, delivered + handover code (synced later if offline)
  R-->>D: delay report (by SMS without data)
  D->>API: delay plan for that vehicle's stops
  API-->>S: new time, with reply buttons
  S->>API: confirm receipt or report a problem
```

## Who can do what

Every request names the role it acts as, and the API checks it against the accounts signed in on that session.
Each account is also tied to the work it covers, and the API checks that scope on every read and command.

| Role | Tied to | Can see and do |
|---|---|---|
| Dispatcher | a depot | the whole plan; publish, move, defer, decide shortfalls and delays; manage the team |
| Loader | a depot | the dock queue; load, flag, mark ready, release |
| Driver | one vehicle (one driver per vehicle) | that vehicle's run only; arrivals, deliveries, delay reports |
| Store manager | one store, or every store in a district (area manager) | those stores' deliveries, handover codes, messages, orders and WhatsApp connection |

Accounts are managed on the dispatcher's *Team* screen (`apps/api/src/team.ts`). A deactivated account stops
working on its next request, because the API reloads the account each time instead of trusting the session alone.

## Deployment

`docker compose up` starts everything below. The seed job runs the migrations and loads the datasets, then exits;
the other services wait for it.

```mermaid
flowchart TB
  user(["Browsers and phones"])
  data[/"./data (datasets, read-only)"/]
  subgraph host["Docker Compose"]
    web["web · Next.js :3000"]
    seed["seed · one-shot<br/>migrations + datasets"]
    pg[("postgres 16<br/>volume pgdata")]
    api["api · Fastify :4000"]
    mq{{"rabbitmq 3.13<br/>:5672, console :15672"}}
    engine["engine · Python worker"]
    notifier["notifier · Node worker"]
    wasim["wa-sim · WhatsApp Cloud API simulator :3200<br/>(Meta's real Cloud API when WHATSAPP_MODE=cloud)"]
  end

  user --> web
  data --> seed
  seed --> pg
  web -- "/api/* proxied" --> api
  web -- "/wa-sim proxied" --> wasim
  api --> pg
  api <--> mq
  mq <--> engine
  mq <--> notifier
  engine --> pg
  notifier --> pg
  notifier -- "send" --> wasim
  wasim -- "signed webhooks" --> api
```

## How a decision travels (example: the loader flags missing crates)

1. The loader's tablet sends `POST /api/commands {type: "loadFlag"}`.
2. The API checks the role and the rules, then in **one database transaction** updates the order's
   progress and appends `load.flagged` to the `events` table (the transactional outbox).
3. The outbox relay publishes the event to the `routelanka.events` exchange with publisher confirms,
   then marks it published. If RabbitMQ is down, events wait in the table and nothing is lost.
4. RabbitMQ routes a copy to every bound queue:
   - each API instance's realtime queue → server-sent event → the dispatcher's screen refreshes and
     the decision card appears;
   - the notifier queue → nothing to send yet (the store is told once the dispatcher decides).
5. The dispatcher chooses "send short" → `load.decided` → the notifier writes the store's WhatsApp
   message; the loader and driver screens update.

## Reliability rules

| Rule | Implementation |
|---|---|
| No lost events | Transactional outbox: state and event are committed together; the relay retries until RabbitMQ confirms. |
| No duplicate effects | Every event has a UUID. Consumers record processed IDs (`processed_messages`) and skip repeats. Field records from phones carry their own UUID, so a re-sent sync is stored once. |
| Poison messages don't block a queue | Failed messages are retried, then routed to a dead-letter queue for inspection. |
| Field facts win | A delivery recorded on the phone is never overwritten by a later plan change; the dispatcher is told instead. |
| Offline driver | The run is cached on the phone at release. Records go to an IndexedDB outbox and sync to `POST /api/sync` when connectivity returns, keeping the time they were recorded. |

## Demo days (isolation for judges)

Reference data (outlets, vehicles, districts, calendar) is shared. Everything that changes during a
walkthrough belongs to a **demo day** (`workspaces` table). The seeded demo day is Friday
24 April 2026. *Start a new demo day* on the sign-in page creates a fresh demo day for that browser,
so two judges using the deployed URL at the same time don't change each other's plan.

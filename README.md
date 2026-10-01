<img src="assets/brand/icon2.jpeg" alt="RouteLanka logo" width="120" align="right">

# RouteLanka

**Team API4 · Tech-Triathlon 2026 · Hackathon.** Delivery planning and tracking for Waypoint Group. One system covers
ordering, planning, loading, delivery and receipt for four roles: **dispatcher**, **loader**, **driver** and **store manager**.
Each role's action reaches the others straight away, through a message broker.

> **Keep this repository private.** The seed data comes from the confidential competition datasets, which must not be published.

* Live demo: **[public URL: add after deployment]**
* Video: **[YouTube link: add after upload]**
* Design (Designathon submission): tag `designathon-submitted`

---

## 1. Run it

Requirements: Docker with Compose v2, and the competition datasets. (Node 20 or newer only for local development without Docker; the images run Node 22 LTS.)

```bash
# 1. Put the datasets in ./data (git-ignored):  data/General Data, data/Training Data, data/Test Data
# 2. Optional: copy the settings and change ports or secrets
cp .env.example .env
# 3. Start everything: Postgres, RabbitMQ, migrations + seed, planning engine, notifier, API, web
docker compose up --build
```

Then open **http://localhost:3000** and sign in with one of the accounts below.

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API (health check) | http://localhost:4000/api/health |
| RabbitMQ management (user `routelanka`, password `routelanka`) | http://localhost:15672 |

On a fresh install the `seed` job applies the migrations, loads the datasets and builds the demo night. It then exits and the
other services start. Re-running `docker compose up` is safe: the seed rebuilds the reference data and the demo night from scratch.

### Seeded accounts (password `routelanka` for all four)

| Role | Username | Scope | Screen size |
|---|---|---|---|
| Dispatcher | `gehiru.dispatch` | both depots (home: Peliyagoda) | desktop |
| Loader | `senash.kandydock` | Kandy depot | tablet |
| Driver | `nimsith.veh041` | VEH041, trip 1 (Kandy → Nuwara Eliya) | **phone** |
| Store manager | `malika.out029` | outlet OUT029 | **phone** (WhatsApp) |

One browser can hold all four sessions. After signing in to several accounts, switch roles from the header without
signing in again.

### Developing without Docker for the apps

```bash
npm install
docker compose up -d postgres rabbitmq seed engine notifier    # infrastructure, data, workers
npm run dev -w @routelanka/api                                # API on :4000 (tsx watch)
npm run dev -w web                                            # web on :3000 (next dev)
```

## 2. Walkthrough for judges (about 10 minutes)

Each step names the account to use. Phone screens can be opened on a phone, or in **/preview**, which shows them inside a
phone frame next to the desktop.

1. **Start fresh.** At the bottom of the sign-in page, choose *Start a new demo day*. You get your own copy of the night, so nobody else's
   clicks interfere. The demo clock reads 03:00 and holds there until the plan is published, then runs at 15× speed.
2. **Dispatcher, plan board** (`gehiru.dispatch` → *Plan board*). The planning engine has proposed tonight's plan: 135
   orders, 124 served on 34 trips, 11 deferred, every deferral with a reason. Select a deferred order (e.g. **OUT070**)
   to see why and every valid move. Drag an order between trips: rule breaks (capacity, reefer, van-only, one
   district per trip, two trips, 270 Fresh minutes) are shown before you drop, and *Publish* stays locked while any rule is broken.
   *Re-plan* sends a planning job to the Python engine over RabbitMQ, and the result appears without a reload.
3. **Publish plan.** Every store gets its message, and every stop gets a random 4-digit handover code.
4. **Store, WhatsApp** (`/preview?path=/store/messages`). A deferred store gets the reason and the new date. A served store
   gets its arrival window and handover code. Tap the language button for Sinhala and Tamil. Tap *Noted, thanks*; the
   dispatcher's feed shows the acknowledgement.
5. **Loader, Kandy dock** (`senash.kandydock` → *Dock* → **VEH041 trip 1**). Tick orders as they go on the truck. On
   **OUT107**, *Flag a problem* → 3 crates missing → *Send to dispatcher*.
6. **Dispatcher, monitor** (`/dispatch/monitor`). The flag arrives live. Choose *Send short*: the store is told before the truck leaves.
7. **Loader.** Load the rest → *Mark ready* → *Release*. The driver's phone shows the run and the store gets "left the depot".
8. **Driver, phone** (`nimsith.veh041`, `/preview`). Tap *Lose signal* (or turn on airplane mode on a real phone).
   Open the first stop → *I've arrived* → type the store's handover code (from step 4's WhatsApp) → *Save delivery*.
   The phone checks the code offline against a hash and keeps the record in its outbox.
9. **Driver, held up.** *Held up? Report a delay* → *Send to dispatcher*. With no data signal, it goes as an SMS.
10. **Dispatcher, map and monitor.** The vehicle shows at its last report (never a guessed live position). The delay
    is waiting. Choose per stop: run late, move to another vehicle, or defer. Then *Confirm and tell the stores*.
11. **Store OUT104** (`/preview?path=%2Fstore%2Fmessages%3Foutlet%3DOUT104`). The delay notice offers *We'll wait* or *Send
    tomorrow*. Tap *We'll wait*, and the dispatcher sees the reply.
12. **Driver, signal returns.** Tap *Signal returns*. The outbox syncs and the delivery keeps the time it was recorded.
    Anything that changed while the driver was offline is shown as a conflict to acknowledge (*Understood*).
13. **Store, receipt.** The store gets "Delivered, verified with your handover code" and confirms or reports a problem.
14. **Behind the scenes.** Open the RabbitMQ management UI: exchanges `routelanka.events`, `routelanka.commands`,
    `routelanka.dlx`. The *Fleet*, *Outlook* and *Impact* screens show fleet readiness, the 10-week capacity outlook and the night's results.

The same night runs as automated tests:
* `python tests/e2e/walkthrough.py` drives the browser through steps 1–13;
* `python tests/smoke/api_flow.py` runs the same night through the API with assertions.

## 3. Architecture

Event-driven services around one shared record. Details: [docs/architecture.md](docs/architecture.md). Data model:
[docs/data-model.md](docs/data-model.md).

```
 browsers/phones ──HTTPS──▶ API (Fastify, TS) ──one transaction──▶ PostgreSQL  (state + events = outbox)
        ▲                       │  outbox relay (LISTEN/NOTIFY, publisher confirms)
        └──── SSE ◀─────────────┤
                                ▼
                            RabbitMQ ──plan.propose──▶ planning engine (Python)
                                     ──domain events─▶ notifier (TS: WhatsApp/SMS messages)
                                     ──all events───▶ every API instance (live screens)
```

* **Transactional outbox.** A command changes state and appends its event in the same transaction. The relay publishes it
  with publisher confirms, so no event is ever lost or invented.
* **Idempotent consumers.** Workers record `(consumer, event_id)` and acknowledge only after their own commit.
  Failures go to dead-letter queues. RabbitMQ can deliver twice; nothing happens twice.
* **Offline-first driver.** IndexedDB outbox, service worker, replays keyed by a client UUID. The server re-checks handover codes on sync.
* **One rulebook.** The operating rules live in `packages/domain` and are shared by the web app and the API. The
  Python engine applies the same rules and passes the organisers' `check_allocation.py`.
* **Planning engine.** Allocation is priority-greedy with every rule checked: chilled and repeat-skipped outlets
  first, scarce vehicles (reefers, vans) kept for the orders only they can carry, and a reason code for every
  deferral. The organisers' `check_allocation.py` passes on scenario S1. Within each trip the engine then tries
  every order of the stops (pairwise swaps above 7 stops) and keeps the one with the fewest expected late
  arrivals. Predictions come from traffic by hour and measured handling times. On the seeded night that cuts
  expected late stops from 27.6 to 19.0 against earliest-closing-window-first.
* **Server-side rules.** The API re-checks every change: a plan that breaks a rule can't be published, a stop
  that has left the depot can't be re-planned from the board, and a stop handed to another vehicle on the road
  needs a vehicle that can carry it (depot, refrigeration, van-only access, not in the workshop). Store orders
  close at 16:00 for the next operating day.
* **Light on the phone.** JSON is gzipped (the day view is about 9 KB instead of 100 KB) and carries an ETag,
  so an unchanged refetch is a `304` with no body. Sinhala and Tamil fonts load only when used.
* **Graceful degradation.** If the notifier or engine is down, planning and delivery keep working, and messages and jobs
  catch up from the queue. If the data signal is gone, the driver keeps working and reports delays by SMS.

```
apps/web            Next.js 16 web app (all four roles, responsive; service worker)
apps/api            Fastify API: auth, commands, views, sync, SMS inbound, SSE, outbox relay
packages/domain     shared types, operating rules, demo clock, handover codes, SMS format (+ tests)
services/engine     Python: migrations, seed, allocation engine, planning worker (+ tests)
services/notifier   TypeScript worker: events → store/driver messages (+ tests)
db/migrations       SQL schema
tests/e2e           browser walkthrough (Playwright)
tests/smoke         API flow test
docs/               architecture, data model, AI disclosure
```

## 4. Configuration

All settings have working defaults; see [.env.example](.env.example).

| Variable | Default | Used by |
|---|---|---|
| `DATA_DIR` | `./data` | seed: where the datasets are |
| `WEB_PORT`, `API_PORT`, `POSTGRES_PORT`, `RABBITMQ_PORT`, `RABBITMQ_MANAGEMENT_PORT` | 3000, 4000, 5433, 5672, 15672 | host ports |
| `POSTGRES_USER/PASSWORD/DB`, `RABBITMQ_USER/PASSWORD` | `routelanka` | infrastructure |
| `SEED_PASSWORD` | `routelanka` | the four demo accounts |
| `SESSION_SECRET`, `SMS_GATEWAY_TOKEN` | development values | API. A production build refuses them unless `ALLOW_DEV_SECRETS=true` |
| `COOKIE_SECURE` | `false` | set `true` behind HTTPS |
| `SMS_SIMULATOR` | `true` | lets the demo send a driver's SMS without a phone network |

## 5. Tests

```bash
npm test                                         # domain rules, API validation, notifier messages (vitest)
cd services/engine && pytest                     # engine; includes the organisers' check_allocation.py on scenario S1
python tests/smoke/api_flow.py                   # API flow against a running stack
python tests/e2e/walkthrough.py                  # browser walkthrough (BASE=http://localhost:3000)
python tests/e2e/interactions.py                 # edits, undo, re-plan, real offline, wrong code, receipt problem, languages
python tests/e2e/crawl.py                        # every screen at desktop and phone size: errors, failed calls, overflow
python tests/e2e/map.py                          # check-in map: keeps the user's view through live updates, moves markers in place
```

## 6. Departures from the Designathon design

| Design | Built | Why |
|---|---|---|
| Offline shown with a toggle | Real offline: service worker, IndexedDB outbox, `navigator.onLine`. The toggle remains as a demo control | So it also works on a real phone in airplane mode |
| Handover code shown as a fixed example | Random code per stop at publish. The phone holds only a hash and the server re-checks it | A fixed code proves nothing |
| Demo clock ran from load | Clock holds at 03:00 until the plan is published | The night starts when the plan is final |
| Prototype state in the browser | Shared state in PostgreSQL, events through RabbitMQ, live updates by SSE | Four people on four devices see the same night |
| Planner ran once at build time | Planner runs as a queue worker on request (*Re-plan*) | A slow plan never blocks the app |

## 7. Demo affordances and security notes

The following exist **only to make judging easy**, and each is a deliberate choice:

* **Store scope.** The store account can open any outlet's messages (`?outlet=`), so the walkthrough can show OUT104
  and OUT029 from one account. In production a store user sees only their own outlet.
* **SMS simulator.** `/api/sms/simulate` lets the driver's phone "send" an SMS through the API. A real gateway posts
  to `/api/sms/inbound` with `SMS_GATEWAY_TOKEN`. Turn the simulator off with `SMS_SIMULATOR=false`.
* **Role switcher and New demo day.** One browser holds all four sessions, and anyone can start a fresh copy of the night.

Security in place: bcrypt password hashes; signed, HTTP-only, SameSite session cookies; a role check on every
command (`COMMAND_ROLES`); zod validation of every input; parameterised SQL only; production refuses development
secrets; handover codes are never sent to the driver.

## 8. Data

The datasets are confidential (competition terms) and are **not** in this repository. Put them in `./data` before
`docker compose up`. The seed builds the demo night from scenario S1 (Peliyagoda) and a Kandy Friday from the
history, and measures the engine's prediction parameters from the route records.

## 9. Team and AI disclosure

Malika Nishnatha, Gehiru Damnidu, Senash Adeesha, Nimsith Senevirathna, Ravindu Lakshan. How AI tools were used:
[docs/ai-disclosure.md](docs/ai-disclosure.md).

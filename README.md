<img src="assets/brand/icon2.jpeg" alt="RouteLanka logo" width="110" align="right">

# RouteLanka

Delivery planning and tracking for Waypoint Group. Team **API4**, Tech-Triathlon 2026.

RouteLanka connects ordering, planning, loading, delivery and receipt for four roles: the **dispatcher**, the
**loader**, the **driver** and the **store manager**. A decision made by one role reaches the others immediately.

| | |
|---|---|
| Live demo | _to be added_ |
| Demo video | _to be added_ |
| Designathon submission | tag [`designathon-submitted`](../../tree/designathon-submitted) |

## Features

- **Planning engine.** Proposes a full plan within every operating rule, explains each deferral, and orders stops to
  reduce late arrivals.
- **Live operations.** Loader flags, driver check-ins and store replies appear on every screen as they happen.
- **Works offline.** The driver's phone keeps working without signal and syncs later. Handover codes are checked on
  the phone.
- **WhatsApp for stores.** Updates and one-tap replies through the WhatsApp Business Platform, in English, Sinhala
  or Tamil.
- **Capacity outlook.** A 10-week forecast of demand against refrigerated capacity, using our Datathon model.
- **Fleet and impact.** Repair priorities, hire-or-defer costs and a pilot scorecard.

## Quick start

**Requirements:** Docker with Compose v2, and the competition datasets.

```bash
# 1. Put the datasets in ./data (General Data, Training Data, Test Data). This folder is not committed.
# 2. Optional: change ports or secrets
cp .env.example .env
# 3. Start the full stack with seed data
docker compose up --build
```

Open **http://localhost:3000**. The first start applies the database migrations and loads a realistic delivery night.

| Service | Address |
|---|---|
| Web app | http://localhost:3000 |
| Stores' WhatsApp phones (simulator) | http://localhost:3000/wa-sim |
| API health | http://localhost:4000/api/health |
| RabbitMQ console (`routelanka` / `routelanka`) | http://localhost:15672 |

### Accounts

The password for all four accounts is **`routelanka`**.

| Role | Username | Works on |
|---|---|---|
| Dispatcher | `gehiru.dispatch` | Desktop |
| Loader | `senash.kandydock` | Tablet |
| Driver | `nimsith.veh041` | Phone |
| Store manager | `malika.out029` | Phone and WhatsApp |

One browser can stay signed in to all four accounts and switch between them from the header. Phone screens can
also be viewed at **`/preview`**, which shows them in a phone frame.

## Judge walkthrough

About 10 minutes, across all four roles.

1. **Start a new demo day.** On the sign-in page, choose *Start a new demo day* to get your own copy of the night.
   The clock holds at 03:00 until the plan is published.
2. **Review the plan.** As the dispatcher, open *Plan board*. The engine has planned 135 orders: 124 served on 34
   trips and 11 deferred, each with a reason. Select **OUT070** to see why it was deferred. Drag an order between
   trips: any broken rule is shown, and publishing is blocked until it is fixed.
3. **Publish.** Every store is notified and every stop receives a handover code.
4. **Store on WhatsApp.** Open `/wa-sim?phone=94770000029` (store OUT029). Read the deferral notice and tap
   *Noted, thanks*. The dispatcher's feed shows the reply. *Dispatcher → WhatsApp* shows each message and webhook.
5. **Load the truck.** As the loader, open *Dock → VEH041 trip 1*. Load the orders, and flag 3 missing crates on
   **OUT107**.
6. **Decide the shortfall.** As the dispatcher, open *Live runs* and choose *Send short*. The store is told before
   the truck leaves.
7. **Release the truck.** As the loader, load the rest, then *Mark ready* and *Release*.
8. **Deliver offline.** As the driver (`/preview`), tap *Lose signal*, open the first stop, tap *I've arrived*,
   enter the store's handover code from step 4, and save. The delivery waits on the phone.
9. **Report a delay.** Tap *Held up? Report a delay*. Without data signal it is sent by SMS.
10. **Re-plan the stops.** As the dispatcher, open *Map* and *Live runs*. The vehicle appears at its last report.
    Choose what happens to each remaining stop, then *Confirm and tell the stores*.
11. **Store replies.** Open store OUT104's messages and tap *We'll wait*. The dispatcher sees the reply.
12. **Signal returns.** As the driver, tap *Signal returns*. The delivery syncs with its original time, and any
    changes made meanwhile are shown to the driver.
13. **Confirm receipt.** The store confirms the delivery or reports a problem.
14. **Explore.** *Fleet*, *Capacity outlook* and *Impact* show the planning side; the RabbitMQ console shows the
    message flow.

Steps 1 to 13 also run automatically: `python tests/e2e/walkthrough.py`.

## Architecture

Event-driven services around one shared PostgreSQL record, connected through RabbitMQ.

```
 Browsers and phones ──HTTPS──▶ API ──▶ PostgreSQL (state + events)
          ▲                      │
          └──── live updates ────┤ outbox relay
                                 ▼
                             RabbitMQ ──▶ Planning engine (Python)
                                      ──▶ Notifier ──▶ WhatsApp Cloud API
```

- **Reliable events.** Each change and its event are saved in one transaction (transactional outbox) and published
  with confirmation. Consumers process each event exactly once.
- **Shared rules.** The operating rules live in one package used by the web app and the API. The engine passes the
  organisers' `check_allocation.py`.
- **Resilient by design.** If a worker or WhatsApp is unavailable, planning and delivery continue and messages catch
  up later.

| Folder | Contents |
|---|---|
| `apps/web` | Next.js web app for all four roles |
| `apps/api` | Fastify API: sign-in, commands, views, sync, webhooks, live updates |
| `packages/domain` | Shared types, operating rules and translations |
| `services/engine` | Python planning engine, demand forecast, migrations and seed |
| `services/notifier` | Store messages and the WhatsApp sender |
| `services/wa-sim` | WhatsApp Cloud API simulator |
| `db/migrations` | Database schema |
| `tests` | End-to-end and smoke tests |

More detail: [architecture](docs/architecture.md) · [data model](docs/data-model.md) · [WhatsApp](docs/whatsapp.md) ·
[AI disclosure](docs/ai-disclosure.md)

## Configuration

Every setting has a working default. See [`.env.example`](.env.example) for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `./data` | Location of the datasets |
| `WEB_PORT`, `API_PORT` | `3000`, `4000` | Host ports |
| `SEED_PASSWORD` | `routelanka` | Password for the demo accounts |
| `SESSION_SECRET` | development value | Must be replaced in production |
| `WHATSAPP_MODE` | `simulator` | `simulator`, `cloud` (Meta) or `off` |
| `PUBLIC_URL` | `http://localhost:3000` | Public address used in links and the webhook URL |

## Testing

```bash
npm test                                  # unit tests: rules, validation, messages, WhatsApp protocol
cd services/engine && pytest              # engine tests, including the organisers' allocation checker
python tests/smoke/api_flow.py            # the full night through the API
python tests/e2e/walkthrough.py           # the judge walkthrough in a browser
python tests/e2e/whatsapp.py              # WhatsApp messages, replies and webhook security
```

Further browser tests cover every screen at phone and desktop size (`crawl.py`), editing and offline paths
(`interactions.py`) and the live map (`map.py`).

## Changes from the Designathon design

| Design | Build | Reason |
|---|---|---|
| Offline simulated with a toggle | Real offline support; the toggle remains for the demo | Works on a real phone in airplane mode |
| Fixed example handover code | A random code per stop, checked against a hash | A fixed code proves nothing |
| State kept in the browser | Shared database and live updates | Four people on four devices see the same night |
| Planner ran once | Planner runs on request (*Re-plan*) | A slow plan never blocks the app |
| Placeholder demand forecast | The Datathon demand model | As the prototype stated |
| Language saved per session | Language saved on each account | The language follows the person |
| WhatsApp shown as a mock-up | WhatsApp Business Platform integration with a simulator | A working channel judges can test |

## Notes for reviewers

- **Demo conveniences.** The store account can view any outlet, the driver's SMS is simulated, and anyone can start a
  new demo day. These exist only to make review easy.
- **Security.** Hashed passwords, signed HTTP-only cookies, a role check and input validation on every command,
  signed and de-duplicated webhooks, and no handover codes on the driver's phone.
- **Data.** The competition datasets are confidential and not included. Keep this repository private.

## Team

Malika Nishnatha, Gehiru Damnidu, Senash Adeesha, Nimsith Senevirathna, Ravindu Lakshan.

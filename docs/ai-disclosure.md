# AI disclosure (Hackathon)

**Tool:** Claude Code (Anthropic), an AI coding assistant used in the terminal as a pair programmer.

## What it was used for

| Area | How AI was used |
|---|---|
| Architecture | The team designed and finalised the architecture: the services, the event-driven flow over RabbitMQ, the data model and the roles. The assistant suggested patterns (transactional outbox, idempotent consumers, dead-letter queues) and we decided which to use. |
| Code | The team wrote part of the code and reviewed the rest. The assistant wrote much of the code in `apps/api`, `services/notifier`, `services/wa-sim`, `services/engine` (worker, seed, migrations), `packages/domain`, the database migrations, the Dockerfiles and `docker-compose.yml`, and connected the web app from the Designathon prototype to the API. It ran the builds and tests and fixed what failed. |
| Features added later | At our request it built the Team page (adding and deactivating staff, one driver per vehicle, district area managers), the load → release → deliver order, the WhatsApp connect flow (JOIN code, QR, STOP), the route panel on the plan board, the night picker for any night in the order history, and the redesigned Capacity outlook. |
| Plan checks | It helped script plan runs across many nights; the team checked each plan against that night's fleet with the organisers' `check_allocation.py`. |
| Deployment | It set up the Railway services (built from our Dockerfiles), the database migrations and seeding on Railway, and the private networking between services. Production secrets are kept in Railway variables only. |
| Tests | The team did all the testing: every role's flow on the local stack and the live site, the README walkthrough, and plan checks with the organisers' `check_allocation.py`. The assistant helped write the automated tests (unit tests, `tests/smoke`, `tests/e2e`). |
| Documentation | It drafted the README, `docs/architecture.md`, `docs/data-model.md`, this file, and the diagram images in `docs/diagrams`. |

| Translations | The Sinhala and Tamil interface text is AI-drafted and still needs review by native speakers. |

## What it was not used for

* The planning engine runs our own code. No AI model is called at runtime, and no data leaves the stack.
* The competition data stays in this private repository's local `data/` folder (git-ignored) and is never published.

## What the team did

* **Architecture:** we designed and finalised the architecture: the services, the RabbitMQ events, the database model and the four roles.
* **Coding:** we wrote part of the code ourselves and reviewed and changed the code the assistant wrote.
* **Testing:** we did all the testing: each role's flow end to end (dispatcher, loader, driver, store) on Docker and on the live site, the numbered README walkthrough, and plan checks across many nights with `check_allocation.py`.

The rules ask us to understand, explain and own every line we submit. We can walk a judge through any file.

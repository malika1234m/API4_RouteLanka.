# AI disclosure (Hackathon)

**Tool:** Claude Code (Anthropic), an AI coding assistant used in the terminal as a pair programmer.

## What it was used for

| Area | How AI was used |
|---|---|
| Architecture | We asked for an event-driven design with a message broker (RabbitMQ). The assistant proposed the transactional outbox, the command and event exchanges, idempotent consumers and the dead-letter setup, and we chose that design. |
| Code | It wrote most of the code in `apps/api`, `services/notifier`, `services/engine` (worker, seed, migrations), `packages/domain`, the database migrations, the Dockerfiles and `docker-compose.yml`, and connected the web app from the Designathon prototype to the API. It ran the builds and tests and fixed what failed. |
| Tests | It wrote the unit tests (`packages/domain`, `apps/api`, `services/notifier`, `services/engine`), the API smoke test (`tests/smoke`) and the browser walkthrough (`tests/e2e`). |
| Documentation | It drafted this README, `docs/architecture.md`, `docs/data-model.md` and this file. |
| Translations | The Sinhala and Tamil interface text is AI-drafted and still needs review by native speakers. |

## What it was not used for

* The planning engine runs our own code. No AI model is called at runtime, and no data leaves the stack.
* The competition data stays in this private repository's local `data/` folder (git-ignored) and is never published.

## What the team did

> **Team: fill this in honestly before submitting.** For example: who made the design decisions, which parts you
> reviewed line by line, what you changed by hand, and how you tested (the walkthrough, the smoke test, the
> organisers' `check_allocation.py`).

The rules ask us to understand, explain and own every line we submit. Every part of the system is covered by a test or by
the numbered walkthrough in the README, and we can walk a judge through any file.

# Hackathon video script (target 7 minutes, unlisted YouTube)

The brief asks for every role in action plus a walkthrough of the code and the architecture. Record the screen at
1440×900. For the driver and store, use `/preview`, which shows the phone screens. `RECORD=1 python tests/e2e/walkthrough.py`
records a clean run of the role scenes that you can narrate over.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:25 | Sign-in page | Team API4, RouteLanka. One system for Waypoint's dispatcher, loader, driver and store manager. Four seeded accounts. |
| 0:25–1:30 | Plan board | The planning engine proposed tonight's plan: every deferral has a reason. Select OUT070, then drag an order to break a rule: the board explains it and blocks *Publish*. *Re-plan* sends a job over RabbitMQ to the Python engine. Publish. |
| 1:30–2:00 | Store phone (WhatsApp) | The deferred store gets the reason and new date in Sinhala, Tamil or English. Served stores get their window and a handover code. *Noted, thanks* appears in the dispatcher's feed. |
| 2:00–2:50 | Loader tablet → Dispatcher monitor → Loader | Load VEH041, flag 3 missing crates on OUT107. The flag appears live on the dispatcher's screen, who chooses *Send short*. The store is told before the truck leaves. Mark ready, release. |
| 2:50–4:00 | Driver phone | Lose signal. Arrive, enter the store's handover code: checked on the phone against a hash, saved in the phone's outbox. Report a delay: with no data it goes by SMS. |
| 4:00–4:40 | Dispatcher map + monitor, store OUT104 | Truck at its last report, not a guess. Decide per stop, then confirm. The store replies *We'll wait*. |
| 4:40–5:10 | Driver phone | Signal returns: records sync with their original times, and conflicts are shown to acknowledge. The store confirms receipt. |
| 5:10–6:30 | `docs/architecture.md` diagram, then code | Event-driven: the API writes state and event in one transaction (show `apps/api/src/events.ts`). The relay publishes with confirms (`relay.ts`). Consumers are idempotent (`processed_messages`, notifier `index.ts`). Shared rules in `packages/domain/src/rules.ts`, with tests from the booklet examples. The engine worker (`services/engine/routelanka_engine/worker.py`) passes the organisers' checker. Offline: `apps/web/src/lib/outbox.ts` + `public/sw.js`. |
| 6:30–7:00 | Terminal: `docker compose up`, RabbitMQ UI | One command runs the whole stack with seed data. Tests: `npm test`, `pytest`, smoke and browser walkthrough. Thank you. |

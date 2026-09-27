# RouteLanka

Delivery planning for **Waypoint Group** (Tech-Triathlon 2026, "The Intelligent Enterprise"). One system connects the store manager's order, the dispatcher's plan, the loader's dock, the driver's run and the store's receipt, so every decision reaches the next person in time to act on it.

| Phase | Deadline (Sri Lanka time) | What lives here |
|---|---|---|
| Designathon | Tue 29 Sep 2026, 23:59 | Clickable prototype in `apps/web` |
| Hackathon | Sun 4 Oct 2026, 23:59 | Same app + FastAPI/Postgres backend, Docker Compose, docs |
| Datathon | Fri 9 Oct 2026, 23:59 | Judged separately; the allocation engine is shared with Task 2B |

> **Keep this repository private.** The competition terms forbid publishing the datasets *or anything derived from them*. `apps/web/src/data/seed.json` is derived from the datasets, so only add teammates as collaborators and never make the repo public. The raw datasets are not in the repo (see [Data](#data)).

---

## Quick start

**You need:** Node 20 (`nvm use` reads `.nvmrc`), npm, and Python 3.10+ if you touch the seed data.

```bash
git clone <repo-url> routelanka
cd routelanka/apps/web
npm install
npm run dev            # http://localhost:3000
```

The seed data is already committed, so the app runs without the datasets.

Open the home page and follow the **Walkthrough** panel. It ticks itself off as you go. Open two tabs (for example, the dispatcher on a laptop and the driver in a phone-sized window) and actions in one appear in the other. Use **Reset demo day** to start again.

## Project structure

```
routelanka/
├── apps/web/                   Next.js 16 app (App Router, Tailwind CSS v4, TypeScript)
│   └── src/
│       ├── app/                One folder per screen
│       │   ├── page.tsx            Home: role picker + live walkthrough
│       │   ├── dispatch/           Order queue · plan board · live runs · capacity outlook
│       │   ├── dock/               Dock queue · load checklist (/dock/[vehicle]/[trip])
│       │   ├── driver/             Today's run · stop flow (/driver/stop/[ref])
│       │   └── store/              My deliveries · place order · confirm receipt
│       ├── components/         Shell (header, role switcher, toasts), ui.tsx (design-system parts)
│       ├── lib/
│       │   ├── store.tsx           Shared demo state (reducer + localStorage + cross-tab sync)
│       │   ├── rules.ts            Operating constraints (capacity, reefer, van-only, time, fuel)
│       │   ├── seed.ts             Typed access to seed.json + lookups
│       │   └── types.ts
│       └── data/seed.json      Generated demo day, don't edit by hand
└── scripts/
    ├── engine.py               Allocation engine (priority-greedy, reason codes)
    ├── build_seed.py           Datasets → seed.json
    └── requirements.txt
```

### How it fits together

- **Demo day:** Fri 24 Apr 2026, a week before Vesak. The Peliyagoda orders and fleet are the Datathon Task 2B peak-day scenario (S1). The Kandy orders are a real historical Friday.
- **`scripts/engine.py`** allocates orders to vehicles and trips and gives every deferral a reason code. **`lib/rules.ts`** mirrors the same rules in TypeScript, so the plan board validates every drag and drop live. If you change a rule, change it in both places.
- **`lib/store.tsx`** holds all demo state in one reducer, saved to `localStorage` and synced across tabs. The driver's offline mode queues field events in an outbox and applies them on reconnect. Field facts win; plan changes are versioned.
- **Predicted arrivals and lateness** in the seed are placeholder heuristics. The Datathon models replace them.

## Data

The competition datasets are **not** in this repo, and `.gitignore` blocks them. To regenerate `seed.json`, get the data from the team drive and place it next to the repo:

```
rootcode/
├── data/                  ← unzip the competition data here (General Data/, Training Data/, …)
├── check_allocation.py    ← the organisers' Task 2B checker
└── routelanka/        ← this repo
```

```bash
cd scripts
python3 -m pip install -r requirements.txt
python3 build_seed.py          # or: DATA_DIR=/path/to/data python3 build_seed.py
```

To check the Peliyagoda allocation against the official rules, export it in submission format and run `python3 ../check_allocation.py <file.csv>` from the repo root. It must print `FEASIBILITY: PASSED`.

## Contributing

### Workflow

1. Pull the latest `main`, then create a branch: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
2. Make small, focused commits in the imperative: "Add fuel meter to dock queue".
3. Before you push, run:
   ```bash
   cd apps/web
   npx tsc --noEmit && npm run lint && npm run build
   ```
   If you changed `engine.py` or `build_seed.py`, also regenerate the seed and run the allocation checker.
4. Open a pull request into `main` that says what changed, which screens it affects, and includes a screenshot for UI changes. Get one teammate to review before merging.
5. Don't push directly to `main` and don't force-push shared branches.

### Code conventions

- **Next.js 16 has breaking changes.** Before using an unfamiliar API, read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/`.
- **Design tokens, not raw colours.** Use the Tailwind tokens from `globals.css`:
  - `night`, `paper`, `card`, `line`, `mute` for structure
  - `hivis` for primary actions and hand-offs
  - `chill` only for chilled goods
  - `ok` and `late` for status

  Text colours must keep 4.5:1 contrast.
- **Reuse the parts in `components/ui.tsx`** (`Btn`, `Chip`, `Card`, `Meter`, `RelayTrack`, icons) before writing new ones. The relay track must look identical for every role.
- **Phone screens** (driver, loader, store on mobile) need touch targets of at least 44 px and must not scroll sideways.
- **Copy:** plain, active, sentence case. Name things the way the user would ("Refrigerated capacity full", not `reefer_capacity`). Errors say what happened and what to do next.
- **New state** goes through the reducer in `lib/store.tsx` as a named action, never by mutating state directly.

### AI tool disclosure

Every phase requires an AI disclosure. If you use an AI tool, note what it did in your PR description so we can compile the disclosure at the end.

## Open tasks

**Designathon (due 29 Sep)**
- [ ] Deploy the prototype and get a shareable link
- [ ] Style guide page (tokens, type scale, status chips, relay track)
- [ ] Figma file: personas, flows + rationale, degradation screens, core tradeoff (content in the team's `designathon/` notes)
- [ ] AI tool disclosure
- [ ] 3–5 min demo video

**Hackathon (due 4 Oct)**
- [ ] FastAPI backend + Postgres schema; move `engine.py` behind an API
- [ ] Auth with 4 seeded accounts (one per role)
- [ ] Service worker + IndexedDB outbox for real offline use on the driver's phone
- [ ] `docker-compose.yml` + `.env.example` at the root; `docker compose up` starts everything with seed data
- [ ] `docs/`: architecture diagram, data model, AI disclosure
- [ ] Improve the allocation engine (e.g. OR-Tools CP-SAT) and keep it passing `check_allocation.py`

**Datathon (due 9 Oct)**
- [ ] Task 1: service-time and lateness labels + models
- [ ] Task 2A: weekly demand forecast
- [ ] Task 2B: optimised peak-day allocation + one-page policy

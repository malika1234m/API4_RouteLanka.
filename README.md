<img src="assets/brand/icon2.jpeg" alt="RouteLanka logo" width="140" align="right">

# RouteLanka

Delivery planning for Waypoint Group (Tech-Triathlon 2026). One system connects ordering, planning, loading, delivery and receipt across four roles: store manager, dispatcher, loader and driver.

> **Keep this repo private.** `seed.json` is derived from the confidential competition data.

## Run it

Requires Node 20.

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

Follow the **Walkthrough** panel on the home page. **Reset demo day** starts over.

## Structure

```
apps/web/src/
  app/          screens: dispatch/, dock/, driver/, store/
  components/   Shell (header, role switcher, toasts), ui.tsx (shared parts)
  lib/          store.tsx (demo state), rules.ts (operating constraints), seed.ts
  data/         seed.json (generated, don't edit)
scripts/        engine.py (allocation), build_seed.py (datasets → seed.json)
```

If you change a rule, update both `scripts/engine.py` and `apps/web/src/lib/rules.ts`.

## Regenerate the seed

Put the competition data in `../data` (it is never committed), then:

```bash
cd scripts
pip install -r requirements.txt
python3 build_seed.py
```

## Contributing

1. Create a branch from `main`: `feat/…`, `fix/…` or `docs/…`.
2. Before pushing, run `npx tsc --noEmit && npm run lint && npm run build` in `apps/web`.
3. Open a pull request with a screenshot for UI changes, and get one review before merging.
4. Note any AI tool use in the pull request; we need it for the competition disclosure.

# Running Page — repository working contract

## Architecture (verify in source before acting)

- Web entry: `src/main.tsx` → `src/App.tsx` → `src/themes/{dashboard,classic}`. Shared domain logic and browser data loader live under `src/core/`; components must not become upstream dependencies of core.
- Source data entry: `run_page/coros_sync.py` → private FIT / importer / SQLite → `run_page/privacy_export.py` → `src/static/activities.json`. `.github/workflows/run_data_sync.yml` is a **COROS-only** master-branch writer; CI must never run credentialed ingestion.
- Public web deployment: Vercel, behind Cloudflare, at `m.placeless.net`. The separate `placeless.net/running/` Cloudflare app is not in this repository. GitHub Pages and Cloudflare Workers are not maintained deploy adapters here.
- Preserve the fork's `origin`; NEVER push to `yihong0618/running_page` upstream or rewrite history/deploy without explicit user approval.

## Data, privacy and fixtures

- Do not read, use, leak, stage, commit, copy into tests, or log raw data from `private/`, `FIT_OUT/`, `GPX_OUT/`, `TCX_OUT/`, `PNG_OUT/`, `Workouts/`, `run_page/data.db`, import manifests or historical GPS objects unless the user specifically authorizes that action.
- Always inspect `scripts/check-public-repository.mjs`, `scripts/validate-public-data.mjs`, and the Python privacy exporter before changing the publication pipeline. Do not bypass safeguards for a production build.
- The safe front-end demo is `pnpm dev:sample` (`data/samples/activities.sample.json`). Synthetic route tests use **invented** coordinates; do not derive them from real activities.
- The public `src/static/races.json` contains **manually approved** race labels only. Never copy unreviewed titles from private Strava/COROS records or estimate official race times from device distance/duration.
- Public Mapbox tokens are browser-visible; secrets and COROS credentials remain in private GitHub Actions settings, not Vite environment values or tracked YAML.

## Refactor principles

- Infer architecture from imports, execution paths and current workflows, not folder names or legacy README claims. Delete confirmed unreachable paths; preserve supported Classic behavior.
- Prefer small, owned modules and fewer compatibility wrappers. When renaming, update callers and tests in the same batch.
- Do not add dependencies or extensive feature flags without a measured need. Choose tests for public behavior and edge cases, especially DST/calendar, FIT imports, privacy, maps and network error recovery.
- Update README / CONTRIBUTING / operational docs whenever source contracts change. Document uncertainty and what was actually verified.

## Validation

```sh
pnpm install --frozen-lockfile
pnpm run check && pnpm run lint
node --test scripts/*.test.mjs
python -m pytest -q                 # use a Python 3.12+ environment with requirements-dev.txt
pnpm run build                      # includes privacy/public-index guards
node scripts/performance/check-bundles.mjs
```

Treat testing a live COROS account, deploying Vercel or altering a private archive as **separate privileged operations**, not normal validation. Leave a clean Git worktree with reviewable commits and report findings, validation evidence, remaining risks and next batch.

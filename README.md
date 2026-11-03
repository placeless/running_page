# Running Page — privacy-first fork

[简体中文](README-CN.md) · [Live dashboard](https://m.placeless.net/) · [Upstream Running Page](https://github.com/yihong0618/running_page)

A bilingual running and activity dashboard built with **React 19, Vite and TypeScript**, with an optional Python/COROS data-ingestion pipeline. This repository is the maintained `placeless/running_page` fork of [yihong0618/running_page](https://github.com/yihong0618/running_page), not a generic deployment of every upstream integration.

The public site is deployed on **Vercel**, behind Cloudflare, at `m.placeless.net`. The unrelated `placeless.net/running/` Cloudflare application belongs to a **different repository**. This project does not configure or deploy that application.

## Run locally — no accounts required

**Prerequisites:** Node.js 20.19+, 22.13+, or 24+ and pnpm (the repository declares its version under `packageManager`). Python 3.12+ is required **only** for the optional ingestion tooling and Python tests.

```sh
corepack enable  # if Corepack is available in your Node installation
pnpm install --frozen-lockfile
pnpm dev:sample  # synthetic, GPS-free fixture; no credentials
```

Open the local address displayed by Vite. The demo mode uses `data/samples/activities.sample.json`, containing 12 entirely invented workouts. It **does not modify** the public activity JSON or invoke COROS. For the existing, privacy-validated public snapshot instead, run `pnpm dev`.

```sh
pnpm run check
pnpm run lint
node --test scripts/*.test.mjs
pnpm run build
node scripts/performance/check-bundles.mjs
pnpm preview
```

`pnpm build` **always** validates `src/static/activities.json` and the public Git index, including in sample mode. Do not bypass this guard. If you need to experiment with data ingestion, generate a preview into `/tmp` and validate it before considering publication; see [privacy export](docs/privacy-export.md).

## Architecture and ownership

```text
COROS Training Hub (private credentials)
          |
       FIT files (private archive: separate Git repository)
          |
   Python importer -> SQLite (private)
          |
   privacy_export.py (private policy, redact/remove GPS)
          |
   src/static/activities.json (validated, public)
          |
   GitHub Actions commits only public JSON to master
          |
   Vercel / Cloudflare proxy -> browser (public)
```

The browser **never** needs COROS credentials, original FITs, SQLite, or the private privacy policy. `src/static/activities.json` is a _public artifact_, not a secure database. A source record is published only through the privacy exporter; frontend filtering is **not** privacy protection.

| Location                                   | Responsibility                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `src/App.tsx`, `src/main.tsx`              | Browser entry and theme registry                                       |
| `src/core/`                                | Shared configuration, hooks, dates, metrics and route geometry         |
| `src/components/`, `src/themes/dashboard/` | Dashboard widgets and page assembly                                    |
| `src/themes/classic/`                      | Independently supported legacy UI, sharing the activity loader         |
| `src/static/`                              | Validated public activity snapshot, geography and public site metadata |
| `run_page/coros_sync.py`                   | Download and import COROS workouts into the **private** database       |
| `run_page/privacy_export.py`               | Enforce privacy policy and produce allowlisted public records          |
| `run_page/reconciliation.py`               | Compare private COROS/FIT/SQLite counts to public totals               |
| `.github/workflows/run_data_sync.yml`      | Fork-specific serialized COROS sync and private archive backup         |
| `scripts/`                                 | Public-data guards, regression tests and optional performance probes   |

Other historical Python provider adapters remain available under `run_page/` for **manual/upstream interoperability**; the automated workflow intentionally invokes **COROS only**. GitHub Pages and Cloudflare Workers are not maintained deployment adapters in this fork.

## Configure and extend

Edit `config.yml` for dashboard/classic theme, locale, goals, colors/branding where supported and the default appearance. To add a theme, create a coherent module under `src/themes/<name>/` and register it in `src/App.tsx`; reuse `src/core/` domain calculations rather than duplicating them in components.

A Mapbox token is optional for the Dashboard: without it, the route map uses **MapLibre with CARTO**, with a no-basemap fallback if necessary. Use `VITE_MAPBOX_TOKEN` as a **public browser token**, restricted by allowed origins. Vite exposes `VITE_*` values to the browser; **never put a secret in one**. The Classic map may require Mapbox. Route geometry is only rendered when explicitly included in the sanitized export; the current demo intentionally contains none.

All source-code changes should have behavioral tests where possible. Prefer assertions on observable output, not implementation details. Do not introduce private activity identifiers or geographic data into fixtures, snapshots, logs or PR descriptions.

## CI, deployment and data safety

- **CI** (`.github/workflows/ci.yml`) runs Python and Node checks across supported versions, validates privacy and builds the frontend. Formatting/lint scripts are non-mutating.
- **COROS sync** (`.github/workflows/run_data_sync.yml`) runs daily and can be dispatched manually **on `master`**. It requires an independent private archive, a repository-scoped SSH Deploy Key, COROS credentials and a private publication policy. It backs up raw data **before** committing allowlisted JSON. Failed integrity/privacy checks block publication.
- **Vercel** builds the public `dist/` frontend from Git. Its build environment is separate from GitHub Actions secrets. This repository neither deploys to the separate Cloudflare Worker/Pages app nor contains an active GitHub Pages publisher.
- **Privacy**: `private/`, FIT/GPX/TCX, SQLite, `PNG_OUT/`, raw workout outputs and generated personal posters must never enter public Git history or builds. Historical exposures require separate remediation, not merely `.gitignore`.

See [fork maintenance](docs/fork-maintenance.md), [deployment boundaries](docs/deployment-boundaries.md), [privacy-export policy](docs/privacy-export.md), [data integrity](docs/data-integrity.md), [performance measurements](docs/performance.md) and [history remediation](docs/history-remediation.md).

## Contributing and attribution

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before substantial changes. The repository uses the original project's **MIT license** (`LICENSE`). Original authorship and general-purpose platform instructions belong to [yihong0618/running_page](https://github.com/yihong0618/running_page); fork-specific behavior and privacy constraints are documented here. **Never submit changes to upstream without a separate, explicit review.**

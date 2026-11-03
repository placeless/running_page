# Maintaining the placeless Running Page fork

This repository is the maintained `placeless/running_page` fork of
[yihong0618/running_page](https://github.com/yihong0618/running_page).
This page describes the **current executable fork paths**, not upstream's
multi-provider examples. See [README](../README.md) for a contributor overview.

## Deployment and ownership

- **Public dashboard:** `https://m.placeless.net/` is built from this Git
  repository by **Vercel**, with Cloudflare proxying the hostname.
- **Independent experiment:** `https://placeless.net/running/` belongs to a
  separate Cloudflare Workers/Pages application and must not be modified.
- **Public frontend:** React/Vite builds `dist/` from `config.yml` and the
  validated `src/static/activities.json`. The browser has no private FIT,
  SQLite database, route policy or COROS credentials.
- **Private source:** the independent `placeless/running-data-private`
  repository stores original FIT and SQLite. Only the sanitized JSON is
  published. Do not infer visibility from `.gitignore` or UI hiding.
- **Legacy deployment:** the GitHub Pages workflow and insecure Docker image
  generator were removed. This fork no longer publishes those adapters.

See [deployment boundaries](deployment-boundaries.md), [privacy export](privacy-export.md)
and [history remediation](history-remediation.md).

## Scheduled COROS sync

`.github/workflows/run_data_sync.yml` is now a **COROS-only** writer, scheduled
at **00:00 UTC every day** and manually dispatchable on `master`. It:

1. Confirms the private archive is configured and the public Git index has
   no forbidden files.
2. Restores the private archive's `data.db`, FIT cache and import manifest to
   the ephemeral runner.
3. Loads the private publication policy, then fetches COROS activities on or
   after **2026-06-30**, refreshing recent FITs for seven calendar days.
4. Imports FIT into SQLite; exports **only** the privacy-allowlisted public
   activity JSON, with the current `RUNNING_PRIVACY_DELAY_HOURS=0` policy.
5. Checks the public export and reconciles provider/FIT/import/SQLite/public
   totals without logging original activity IDs or coordinates.
6. Commits all changed raw files **only** to the private archive, then commits
   only `src/static/activities.json` to the public `master` branch.

Workflow concurrency prevents two writers from racing; a failing phase stops
publication. The Vercel build runs after its connected Git repository updates,
not as a separate Actions deployment step. Source scripts for Strava, Garmin,
Nike and others are still present for _manual/upstream interoperability_; none
are selectable through this fork's scheduled workflow. Do not reintroduce
multi-provider secret command-line invocations in a public CI job.

The optional personal image-sharing helper `run_page/auto_share_sync.py` is
manual-only. Its `openai` SDK is installed with `uv sync --extra share`; it
is intentionally absent from the COROS `requirements.txt` and regular CI.
Never expose an image-generation API key or original GPS through public jobs.

### Required GitHub Actions settings

| Name                           | Kind              | Purpose                                                                   |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------- |
| `COROS_ACCOUNT`                | Secret            | Training Hub account                                                      |
| `COROS_PASSWORD`               | Secret            | Raw COROS password; the downloader derives the expected login digest      |
| `RUNNING_PRIVATE_REPOSITORY`   | Variable          | Must match this fork's pinned `placeless/running-data-private`            |
| `RUNNING_PRIVATE_DEPLOY_KEY`   | Secret            | SSH private key of a **write-enabled deploy key for that single archive** |
| `RUNNING_PRIVACY_POLICY_JSON`  | Secret            | Private privacy policy; never store sensitive zones in this repository    |
| `COROS_DOWNLOAD_ALLOWED_HOSTS` | Optional variable | Comma-separated signed storage hosts, verified privately before pinning   |

The archive's fixed repository identifier is intentional: a different user
forking the project must review this trust boundary and explicitly replace the
pin. The public workflow cannot run securely with only COROS credentials.
The Vercel project's `VITE_MAPBOX_TOKEN`, if desired, is configured
**separately** and is a restricted **public browser token**, not an ingestion
secret. GitHub Actions secrets are not automatically passed to Vercel.

To test COROS locally, install Python 3.12+ dependencies, then use environment
variables without putting credentials in shell history or command-line
arguments. Preserve original FIT/SQLite in an independent private backup;
never point the exporter at the tracked public JSON until its validation has
passed against a temporary file.

### Cutover and data integrity

The `2026-06-30` cutoff protects against duplicate historic Strava and COROS
records that use unrelated provider IDs. Removing it requires a deliberate,
validated deduplication and private backfill plan; it is **not** a fix for
missing records. Individual zero-distance strength workouts are supported,
while zero-distance runs remain excluded. `RUNNING_FIT_TIMEZONE` is set to
`Europe/Madrid` as a fallback for FIT sessions with no authoritative local
date. The current sync publishes all recorded dates through today's UTC date
(`RUNNING_PRIVACY_DELAY_HOURS=0`); changing it does not alter redaction zones.

The COROS downloader uses an authenticated API client and a separate anonymous
HTTPS downloader for signed FIT links. Optional exact-host allowlisting should
be enabled **only after private verification** of real storage hosts; the
provider can use different regions and redirects. The provider list and the
import manifest do not alone establish archival completeness. The aggregate
auditor's optional `--deep-fit` mode performs more expensive FIT-to-SQLite
identity checks. See [data integrity](data-integrity.md) for what has actually
been verified and what remains unknown.

## Updating upstream safely

The `upstream` remote is **read/fetch only**; the fork's `origin` owns the
maintained branch. Never use GitHub's unreviewed overwrite/sync function or
force-push historical backup refs. Start with a clean checkout and review
upstream on a separate branch:

```sh
git status --short
git fetch origin master
git fetch upstream master
git switch master
git merge --ff-only origin/master
git switch -c maintenance/upstream-YYYY-MM
git merge upstream/master
```

Resolve integration conflicts against **current imports and behavior**. Keep
the privacy-export boundary, the validated public JSON, private archive
ownership and Vercel deployment. Do not restore deleted raw GPS assets,
unsafe Docker/Pages publishing, or the old credentialed multi-provider sync
workflow. Re-run Node, Python, privacy, production build and synthetic route
tests, then review and merge through the fork's `master` only when authorized.
The `dashboard` theme is the default; `classic` remains a supported optional
theme via `config.yml`.

## Map and geography notes

`run_page/generator/geography.py` classifies public coarse country/province
values using local boundaries where possible; unknown locations stay unknown.
`src/core/routeGeometry.ts` and related helpers process **already-redacted**
route segments without bridging gaps around protected places. Dashboard maps
load Mapbox (when configured) or MapLibre/CARTO on demand and can fall back to
plain geometry. City/region data has one shared canonical module.
The Spanish province dataset and attribution are documented at
`run_page/generator/data/README.md`.

Historically exposed raw GPS, old deployments and GitHub cached links are
outside routine source cleanup. See [history remediation](history-remediation.md)
before attempting any historical rewrite or purge.

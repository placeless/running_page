# Running Page quality review and refactor plan

Audit baseline: local `master` at `5b396187` (2026-11-03). This review concerns
`placeless/running_page`, deployed at `m.placeless.net`, **not** the independent
application at `placeless.net/running/`. This file preserves the **historical audit baseline**; the implementation
status of each batch is recorded below, separately from original findings.

### Post-release correction — standard-distance matches

The first Batch 1 release used a symmetric ±1% distance tolerance for the
MatchedRunTimes card. This excluded recorded race-length activities with
normal GPS distance overrun, even when they were faster than the remaining
candidates. Corrected the matching to accept a 1% GPS undershoot and bounded
overruns (5K up to 5.5 km, 10K to 11 km, half-marathon to 22.5 km,
marathon to 44 km), retaining the original reasonable running-pace guard.
The card continues to display **full-activity moving time and actual recorded
distance**, not an estimated distance-normalized split or certified PB.
Synthetic regression tests verify both the overrun and outlier cases.

### Batch 0 implementation status

Implemented locally on `review/batch-0-security` (not deployed):

- Signed COROS file URLs are now downloaded using a separate unauthenticated
  HTTP client, with HTTPS/hostname/redirect validation, optional exact-host
  pinning and a download size cap. No provider-specific storage domain is
  assumed without evidence.
- Data-sync workflow serializes all writers using a repository-scoped
  concurrency group with `cancel-in-progress: false`.
- All production builds enforce the public JSON guard, regardless of the old
  unsafe-preview environment variable.
- The raw-data Actions Cache capability is removed from both sync and
  optional Pages workflows; GitHub Pages itself remains an optional adapter.
- CI's lint and aggregate check commands no longer mutate the working tree,
  and the FIT strength-training import tests run in the CI matrix.
- Synthetic Python and Node regression tests cover the new security and
  workflow invariants. No private activity source was accessed to run them.

Local verification: 90 Python tests, 3 Node release-safety tests, Black, Ruff,
TypeScript, ESLint, and Vite production build passed. No production download,
GitHub Actions run, private archive write, or browser audit was performed.

Remaining: confirm the legitimate signed storage hostname(s) in a private
runtime before optionally enabling `COROS_DOWNLOAD_ALLOWED_HOSTS`; validate the
new CI and end-to-end sync in GitHub Actions only after review and merge.

### Batch 1 implementation status

Implemented locally on `review/batch-1-data-correctness`, based on Batch 0:

- Pure domain modules under `src/core/domain/` now own provider-local
  calendar dates, streaks, aligned period comparisons, sport-scoped metrics,
  and full-activity distance matching.
- Dashboard, Tracks, Summary, profile, calendar, and heatmap callers were
  updated for date-only exports. Daily charts aggregate by sport and minutes;
  they no longer fabricate a start-time histogram.
- Historical years compare complete years; present YTD/month/week compare
  equal calendar windows with leap-day/month-end clamping. Running pace uses
  total running distance divided by total running time.
- The old "Personal Best" card now explicitly describes nearby-distance
  **full activity** times, with actual recorded distance and asymmetric
  distance bands (small GPS undershoot, larger recorded overrun),
  not verified event PBs or segment efforts. The component has been renamed
  from `PersonalBest` to `MatchedRunTimes` to match its actual responsibility.
- Private COROS sync now produces a disposable, ignored activity-ID list for
  aggregate source/FIT/manifest/SQLite/public reconciliation. The auditor
  reads SQLite without modifying it and logs no identifiers or locations.
- FIT files with an invalid header are re-fetched instead of perpetually
  considered cached. Optional deep FIT-to-DB identity matching remains
  an explicit manual audit rather than a daily decoding cost.

Validation: synthetic Node domain tests on two timezones, Python reconciliation
and importer tests, static checks and a production build. Live GitHub Actions
sync and browser/visual tests remain outstanding; no private data was opened
to validate this batch.

### Batch 2 implementation status

Implemented locally on `review/batch-2-resilience`, based on Batch 1:

- **Shared loader:** Classic now consumes the same Suspense activity-data cache
  and `resetActivityData()` retry path as Dashboard. No second fetch or stale
  error cache remains inside its theme hook.
- **Map isolation:** A map-specific React error boundary handles renderer
  construction/import failures without replacing the full application. A
  reusable non-WebGL route-list fallback preserves access to public activity
  details; style failures retain Mapbox → CARTO → plain fallback and retry.
  Maps without visible routes do not initialize WebGL.
- **Redacted route geometry:** Map, thumbnail, route eligibility and worker
  share validation of `route_segments`; each visible part is rendered as a
  separate line and never bridged across a private gap. Invalid individual
  segments no longer discard other valid parts.
- **Grouping and selection:** The worker groups by interior geometry signature
  and distance rather than endpoints alone. Clusters retain every activity
  index; expanding a group exposes its members. Worker failure degrades to
  individual, accessible tracks rather than an infinite loading state.
- **Accessible state:** Document `lang` follows validated and persisted
  Chinese/English preferences, including the pre-React HTML bootstrap;
  the active orange sport filter uses a contrast-tested dark foreground,
  and route controls, track thumb focus rings and touch targets are refined.
- **Regression coverage:** Synthetic tests exercise geometry identity,
  segmented GPS, grouped member retention, Classic retry, map fallback markup,
  locale allowlisting, and WCAG contrast alongside the Batch 1 test suite.

Browser smoke (Firefox 159 Headless): tested a temporary synthetic-route
page with desktop 1280×900 dark and mobile 390×844 light/dark screenshots.
Both color modes rendered legible initial layout and statistics, but the
screenshots were taken **before** lazy WebGL and worker rendering completed.
A forced WebGL-off screenshot was likewise captured while still loading.
These are partial visual smoke checks, not proof of route/renderer recovery,
finished map quality, keyboard navigation, or assistive technology behavior.
The synthetic fixture and its temporary local servers were removed after QA.
At the end of Batch 2, WebGL failure interaction and live provider error
behavior remained untested. Batch 3 subsequently covered simulated WebGL
failure and invalid-token fallback in Firefox, not production credentials.

### Batch 3 implementation status

Implemented locally on `review/batch-3-performance`, based on Batch 2.
See [performance.md](performance.md) for measurement protocol, raw numbers,
ablation decisions and validation limits.

- Firefox 159 WebDriver BiDi benchmark using fresh isolated profiles,
  production Vite output, desktop/mobile viewports and a completely
  invented 500-route fixture. No private FIT, SQLite or provider IDs used.
- Changed the two eager WebGL imports to on-demand provider imports, while
  removing runtime Mapbox coupling from coordinate-bound calculations.
  Synthetic-route cold Home transferred **57.1% less JavaScript** without
  losing the map; invalid-token and WebGL-disabled fallbacks were exercised.
- Deferred the world boundary GeoJSON until the `FootprintMap` approaches
  the viewport. Mobile first-visit local transfer fell **31.2%**; scrolling
  still loaded and rendered 239 SVG paths. Visible desktop behavior stayed
  eager.
- Added a non-browser Vite-manifest guard to CI to ensure both map engines
  remain excluded from initial static imports. Other large chunks were
  investigated but not changed without runtime evidence.

Limitations: local HTTP did not use CDN compression or network throttling.
Observed FCP/LCP changes were negligible. INP, CLS, device memory and
repeat-run performance distributions remain unverified.

### Batch 4 implementation status

Implemented locally on `review/batch-4-oss-cleanup`, based on Batch 3:

- Confirmed both Classic city and site-metadata copies were byte-identical
  to their shared `src/static/` versions; removed the duplicates, redirected
  the two actual imports and removed four unused compatibility reexports.
- Removed the unreachable `isGym=false` code and synthetic monthly gym UI,
  retaining activity/day/week and all-sport heatmap behavior. Added an SSR
  behavior regression for mixed running and zero-distance strength workouts.
- Replaced the old conditional multi-provider Actions workflow with a
  **COROS-only 159-line pipeline**, preserving its private archive restore,
  policy, signed-FIT downloader, reconciliation, backup-first ordering,
  master-only restriction, JSON allowlist commit and serialization.
- Removed the unused GitHub Pages publisher and an obsolete Docker image
  builder using Node 18, build-argument credentials and raw GPS posters.
  Historical provider Python scripts remain for manual/upstream use, but
  their runtime steps are no longer exposed by the sync workflow.
- Untracked (without deleting local files) two historical `PNG_OUT` share
  images; added `PNG_OUT/`, `Workouts/` and the obsolete `src/run_page`
  symlink to the public index denylist. No private image contents were
  examined and no Git history was rewritten.
- Removed the duplicate PDM lockfile (the active `uv.lock` remains), stale
  Garmin-specific config example, and two standalone TUI prototypes that
  were incorrectly collected by pytest; kept supported Python/TUI modules.
- Rewrote README (English/Chinese), CONTRIBUTING, and fork maintenance;
  added concise AGENTS.md and a **dev-only** 12-activity synthetic sample
  fixture. `pnpm dev:sample` exercises the frontend without account or
  database access; production always validates and builds the real public
  export, even under `--mode sample`.
- Aligned package metadata and Makefile checks with current workflows;
  added offline sample-mode, privacy-guard and heatmap regression tests.

Remaining: review complete GitHub Actions execution after a merge to `master`,
verify fresh-clone installation and both themes in a live browser, review
old public PNG history/cache separately, and audit remaining upstream Python
adapters/legacy frontend compatibility paths before any larger deletion.

### Batch 5 integration review status

After Batch 4, a separate integration branch verified clean-install behavior,
Python/Node version matrices, both built themes, and browser interactions.
The detailed evidence and remaining risks are in
[integration-validation.md](integration-validation.md).

- A Git archive of Batch 4 was initialized as an isolated Git repository and
  installed with frozen pnpm 8.9.0 dependencies; a second clean archive
  passed a normal pnpm install with lifecycle scripts enabled; Dashboard and Classic both
  built successfully. No private data directories were copied or read.
- Firefox 159 Headless loaded public Home, Tracks/Summary and both themes on
  desktop/mobile. An additional Chinese-default Dashboard build verified
  locale, theme and page navigation from the zh-CN starting state. Dashboard tested English/Chinese locale, light/dark toggles,
  Home/Summary navigation, and 500 entirely synthetic redacted routes with
  MapLibre canvas. Classic home/summary and theme toggle rendered, but Classic
  still eagerly initializes Mapbox for route-less activities.
- Python 3.14 exposed an outdated locked Pydantic/PyO3 dependency chain.
  The actual CI pip install already worked, but `uv.lock` was inconsistent.
  Updated the affected Python binary dependencies; `uv --locked` then passed
  on Python 3.12, 3.13 and 3.14. Moved the unused-in-sync OpenAI image client
  into an opt-in extra, and changed CI to discover all synthetic test cases.
- The Firefox probe can now assert visible content, browser error counters
  and basic real DOM interactions; it does not infer tile/network success
  from WebGL canvas presence.

No private COROS download, archive publication, upstream push, Vercel deploy,
Git history rewrite, or production host change is part of this review.

## Ground rules

- Preserve the upstream merge path; never push to `yihong0618/running_page`.
- Keep source FIT, SQLite, credentials, protected-zone coordinates and any
  sensitive route graphics outside the public repository and build output.
- Make behavior and privacy tests precede refactors; delete code only after
  proving a branch is unused or replacing its behavior.
- Judge optimizations by actual loaded bytes, execution traces and UX, rather
  than total bundle size or hypothetical re-render counts.
- Do not modify the separate Cloudflare Pages/Worker deployment.

## Verified baseline

- `python -m pytest -q` with the local virtual environment: 76 passed, three
  warnings (SQLAlchemy 2.0 legacy API and two pytest class-collection warnings).
- TypeScript `tsc --noEmit`, non-writing ESLint and Vite production build pass.
- Public-data repository guard, Node JSON validator and Python privacy checker
  pass; 957 exported records, no route geometry in the current public file.
- Vite builds two distinct GL-related chunks (Mapbox GL approximately 474 KiB
  gzip and RouteMapCanvas approximately 277 KiB gzip). The current dashboard
  does **not** load MapCanvas when all published routes are absent; bundle
  figures are not a measurement of present-day first-load transfer.
- No live Lighthouse/Core Web Vitals trace, keyboard/VoiceOver audit, or
  end-to-end preview/production test has yet been collected.

## Findings register

The table below is a **historical baseline**, not a current backlog/status
report. The corresponding batch implementation statuses above record resolved
items. Priority reflects risk, not implementation complexity.

| Priority | Status                                  | Finding and code ownership                                                                                                                                                                                      | Proposed correction                                                                                                                  |
| -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | Confirmed behavior; exposure unverified | `run_page/coros_sync.py` reuses an authenticated `httpx.AsyncClient` for an API-provided FIT download URL, forwarding its token/cookie headers even for cross-origin requests                                   | Validate HTTPS and allowed download hosts/redirects; separate the API client from the file transfer client and test rejected targets |
| P1       | Confirmed design gap                    | `.github/workflows/run_data_sync.yml` has no concurrency lock around two writable Git repositories                                                                                                              | Serialize sync jobs with a stable group and `cancel-in-progress: false`; test overlapping dispatches                                 |
| P1       | Confirmed guard bypass                  | `vite.config.ts` permits `RUNNING_ALLOW_UNSAFE_LOCAL_PREVIEW=1` to skip the activity JSON validator even during a production build                                                                              | Fail closed in CI/production regardless of the variable; keep explicitly isolated local-only fixture previews                        |
| P1       | Reproduced by synthetic input           | `src/components/StatsCards.tsx` compares a historical full year with the prior year only through the current day-of-year                                                                                        | Historical complete-year vs complete-year; current-year year-to-date vs previous equivalent cutoff; leap-year fixtures               |
| P1       | Confirmed semantics                     | `src/utils/summary.ts` mixes strength-training duration into an all-sports average speed; `src/components/TracksPage.tsx` averages per-activity speeds instead of computing total distance / total running time | Shared activity-domain aggregation with explicitly scoped sport metrics                                                              |
| P1       | Confirmed semantics                     | `src/components/PersonalBest.tsx` labels best full-activity times across broad distance bands as exact 5K/10K/HM/marathon PRs                                                                                   | Distinguish closest matching full activity from verified exact-distance effort; do not infer split PRs from redacted route data      |
| P2       | Reproduced by synthetic input           | `StatsCards.tsx` relies on elapsed milliseconds for calendar-day streaks; DST creates false gaps                                                                                                                | Pure LocalDate calendar arithmetic; exercise DST, year boundaries, leap days, and negative UTC offsets                               |
| P2       | Reproduced by synthetic input           | `src/themes/classic/hooks/useActivities.ts` has an independent failure cache unaffected by global Retry in `src/components/ErrorBoundary.tsx`                                                                   | One shared data-loader/cache/retry contract across themes                                                                            |
| P2       | Reproduced by synthetic input           | `src/components/TracksPage.tsx` ignores valid `route_segments` without sufficiently long `summary_polyline`                                                                                                     | Use one route eligibility/decoding contract and render separate, unconnected segments                                                |
| P2       | Reproduced by synthetic input           | `src/workers/clusterTracks.worker.ts` clusters routes using endpoints and coarse distance only, then hides all but one member                                                                                   | Preserve cluster membership and user access; assess geometry similarity if grouping is retained                                      |
| P2       | Confirmed error-boundary placement      | `src/components/RouteMapCanvas.tsx` can throw during WebGL constructor setup inside a single app-wide error boundary                                                                                            | Map-local error boundary / fallback; no whole-page failure on no WebGL                                                               |
| P2       | Confirmed                               | `src/utils/summary.ts` emits an undifferentiated `—` time bucket for all public date-only activities                                                                                                            | Use date-only summaries and avoid asserting unavailable hourly detail                                                                |
| P2       | Confirmed                               | `index.html` language is fixed to `en`; `src/core/hooks/useLocale.tsx` changes React state, not `html.lang`                                                                                                     | Keep document language synchronized with locale and validate stored locale values                                                    |
| P2       | Calculated                              | Selected running filter in `TracksPage.tsx` uses white on `#f97316` (~2.80:1), below WCAG AA 4.5:1 for ordinary text                                                                                            | Use tested dark foreground and add state/contrast checks                                                                             |
| P2       | Needs policy review                     | Old `gh-pages.yml` can cache original FIT, GPX and SQLite files and is not the production deployment path                                                                                                       | Delete unused publish/cache workflow in this fork, or remove all raw-data cache paths if still supported                             |
| P2       | Needs content inspection                | Two checked-in `PNG_OUT/share_image_*.png` files are not covered by the private-graphics denylist                                                                                                               | Inspect for personal route/location exposure; archive privately and untrack if necessary                                             |
| P3       | Measured bundles, not runtime           | Mapbox and MapLibre are imported together inside `RouteMapCanvas.tsx`, though its parent is visibility-gated                                                                                                    | Compare per-provider dynamic imports and renderer lifecycle against existing fallback before changing                                |
| P3       | Confirmed duplication                   | `src/static/city.ts` is byte-identical to `src/themes/classic/static/city.ts`                                                                                                                                   | Replace with a canonical module, then remove duplicate                                                                               |
| P3       | Confirmed dead path                     | `ContributionHeatmap.tsx` hard-codes `isGym = false`; its separate gym-month render branch cannot execute                                                                                                       | Delete unreachable branch, unused color table/state and JSX after behavior comparison                                                |
| P3       | Confirmed                               | `package.json` CI script calls format and ESLint `--fix`, mutating the working tree while ostensibly validating                                                                                                 | Separate `check`, `lint`, `test`, `build` from opt-in `format:fix`/`lint:fix`                                                        |
| P3       | Confirmed                               | `CONTRIBUTING.md` contains only “Always welcome.”; generic upstream README conflicts in places with current Vercel/COROS fork architecture                                                                      | Add a concise contributor guide and clearly label upstream vs fork-specific deployment documentation                                 |

## Batches and acceptance criteria

### Batch 0 — security and release guardrails

1. Separate COROS API authentication from signed FIT retrieval, validate file
   URL schemes/hosts/redirects, and add hostile redirect/host synthetic tests.
2. Serialize the data-sync workflow, prevent production unsafe-preview bypass,
   and test against a synthetic unsafe activity export.
3. Disable/remove obsolete private-file cache configurations after verifying
   no active GitHub Pages deployment depends on them.
4. Preserve all private archives and avoid any Git history rewrite or
   production deployment in this batch.

**Gate:** no credentials on cross-origin file requests; unsafe public records
make every publish build fail; concurrent jobs cannot race to update the
archive. Run all current Python, TypeScript, ESLint and build checks.

### Batch 1 — data model, correctness and regression tests

1. Introduce pure LocalDate and typed sport aggregation functions in a small
   domain module; migrate callers without creating a general utility layer.
2. Resolve consistent definitions for pace, all-sport metrics, yearly
   comparisons, streaks and the meaning of personal-best results.
3. Add synthetic fixture tests for zero-distance workouts, mixed sports, DST,
   dates without time, 5K vs 4.8K, 10K vs 11K and period boundaries.
4. Implement read-only COROS index → FIT → SQLite → public JSON reconciliation
   with explicit exclusion reasons and no sensitive identifiers in logs.

**Gate:** all displayed metrics use the same documented formulas; no historical
cutoff or time-zone-dependent surprises; reconciliation reports explain every
record category, not just the public count.

### Batch 2 — resilience, design and accessibility

1. Give each map independent error handling, empty/route-private presentation,
   a WebGL-off fallback and provider retry behavior.
2. Preserve user access to all tracks in a cluster, support segmented routes
   without joining protected gaps, and align Tracks/Map selection behavior.
3. Synchronize `html.lang`, review locale persistence, selected-state contrast,
   touch targets, keyboard navigation, focus visibility and reduced motion.
4. Assess dashboard information hierarchy across mobile/desktop and
   light/dark with screenshots at the same viewport/data fixture.

**Gate:** synthetic route cases remain accessible; no full-page failure from
Mapbox/WebGL; keyboard and screen-reader states are meaningful; documented
contrast requirements pass.

### Batch 3 — performance: measure, ablate, retain winners

1. Measure cold and warm visits for Home, Tracks, Summary, and route-enabled
   preview, on mobile/desktop, in light/dark and with network throttling.
   Record LCP, INP (where available), CLS, main-thread time, loaded bytes,
   network waterfall and memory changes.
2. Compare (A) current lazy map, (B) conditional Mapbox/MapLibre import, and
   (C) simplified non-WebGL / fallback mode under the same fixtures.
3. Profile map style load/fallback, world/China shape parsing, Recharts page
   transitions, worker clustering, export-to-PNG and long heatmap rendering.
4. Keep only improvements with demonstrated UX or resource advantages and
   no map-language, privacy, or accessibility regressions.

**Gate:** record before/after measurements with device/browser and route
fixture, and retain or revert each ablation on evidence. No assumption that
conditional GL chunks improve the currently route-less Home page.

### Batch 4 — consolidation, cleanup and open-source readiness

1. Eliminate confirmed dead `isGym` branches and identical `city.ts` copies.
2. Consolidate data loading and migration-safe compatibility reexports only
   after import graph usage has been checked in both themes.
3. Review the actual need for legacy workflows, provider scripts, Python
   lockfiles and generated assets; keep upstream interoperability explicit.
4. Separate non-mutating CI checks from formatting commands, update
   `CONTRIBUTING.md`, and reconcile README/docs with actual deploy ownership.
5. Add a minimal sample-data contributor workflow without requiring COROS
   credentials, Mapbox tokens or any private activity history.

**Gate:** unused files are demonstrably unused; fresh clone on documented
versions can install, test and build with synthetic safe data; final diff is
smaller, module boundaries clearer, and docs match behavior.

## Risk register / evidence still missing

- The current COROS returned `fileUrl` host and redirect policy have **not**
  been verified as a real-world credential leak. The reproducible problem is
  header forwarding by the reusable HTTP client.
- The complete provider-side activity inventory and historical pre-cutover
  deduplication have **not** been independently reconciled.
- Local Firefox FCP/LCP and transfer metrics, route-enabled rendering, and
  simulated WebGL failure have been measured in Batch 3. Trusted INP, CLS,
  throttled-network performance, full screen-reader behavior and live visual
  quality across browser engines remain unmeasured.
- The independent `placeless.net/running/` app and historic GitHub caches are
  separate audit surfaces. This plan does not claim to cleanse them.
- The present route-less public export cannot exercise route visualizations:
  Batch 3 used a separate 500-route synthetic fixture, not original GPS.

# Batch 0–4 integration verification (2026-11-03)

Scope: `placeless/running_page` from Batch 4 local commit `8070de7b`, with
Batch 5 integration corrections. **Not** the separate Cloudflare application
at `placeless.net/running/`.

## Setup and isolation

A clean source snapshot was created using `git archive HEAD`, extracted into
an isolated temporary directory, initialized as a new Git repository, and
staged only the 219 current public paths. No ignored or private data paths
were copied or opened. All browser tests served local Vite build assets and
already-public or **entirely synthetic** activity JSON on `127.0.0.1`.

Pinned pnpm 8.9.0 installed with `--frozen-lockfile --ignore-scripts` in the
first clean snapshot. Frontend check/lint, 29 Node tests, TypeScript and
Dashboard Vite build passed. A second independent source archive also passed **normal**
`pnpm install --frozen-lockfile` with lifecycle scripts enabled,
production Vite build, bundle guard and public index guard. The first Classic
Vite build used an edit to `config.yml` **in the disposable snapshot only**;
no personal configuration or source data was modified in the working repo.

## Browser matrix

Firefox **159 Headless**, WebDriver BiDi, fresh isolated profile, local
production output. Dashboard defaults to English; Classic keeps its legacy
fixed English presentation. Desktop viewport **1280×900** dark mode, mobile
**390×844** light mode.

| Case                                       | Result          | Direct evidence                                                                       |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------- |
| Dashboard Home / Tracks / Summary, desktop | Passed          | DOM content loaded; no app-level error                                                |
| Dashboard Home / Tracks / Summary, mobile  | Passed          | Content and navigation rendered; no uncaught window events                            |
| Dashboard Home interactions                | Passed          | Light↔dark, en↔zh-CN, Summary→Home navigation all restored                            |
| Classic Home, desktop and mobile           | Passed          | Rendered run table; theme toggle restored                                             |
| Classic Summary, desktop                   | Passed          | Summary route rendered                                                                |
| Dashboard synthetic 500-route Home         | Passed          | MapLibre WebGL canvas created, no whole-page error; theme, locale and navigation work |
| Classic synthetic 500-route Home           | Passed          | Mapbox WebGL canvas created; no app-level error or uncaught window events             |
| Chinese-default Dashboard, mobile          | Passed          | `html.lang=zh-CN`; theme/locale/summary/home interactions restored                    |
| Classic `/tracks` path                     | Legacy behavior | Falls back to the home route, no dedicated Tracks page                                |

**Limitations:** WebGL canvas presence is not proof that external map tiles
were loaded; Classic still eagerly loads Mapbox without GPS route data.
No real Mapbox production token, mobile network throttling, Chromium/Safari,
VoiceOver, full keyboard navigation, screen-reader support or long-session
memory trace was exercised. See [performance results](performance.md).

Browser replay after `pnpm build` (Firefox and Node 22+ required):

```sh
node scripts/performance/measure-browser.mjs \
  --dataset public --viewport mobile --verify-ui dashboard \
  --out /tmp/running-ui.json

# Build with theme_preset: classic in an isolated copy of config.yml:
node scripts/performance/measure-browser.mjs \
  --dataset public --page / --viewport desktop --verify-ui classic \
  --out /tmp/running-classic.json
```

For synthetic routes, use `--dataset synthetic --page / --viewport desktop`
with the Dashboard build. The fixture's 500 coordinates are invented and
never derived from, or joined to, personal tracks.

## Python dependency mismatch and resolution

`uv --locked` with Python 3.14 initially failed because `pydantic-core 2.33.2`
shipped PyO3 0.24, which supports at most Python 3.13. At the start, both the base
`openai` image client and legacy Garmin adapter `garth` could pull in the
outdated transitive dependency. Moving OpenAI to an opt-in extra alone did
not fix it because `garth` also requires Pydantic. Independently, Python 3.14 **did** install
`requirements-dev.txt` (the current GitHub CI path) and pass all then-existing
99 tests; thus it would have been inaccurate to declare the CI job broken.

The personal OpenAI image-sharing dependency was moved out of routine COROS
and CI requirements into a Python `share` extra. The lock was selectively
refreshed for Pydantic/PyO3-compatible wheels as well as old NumPy, lxml and
DuckDB source builds that lacked Python 3.14-compatible wheels. The updated
`uv.lock` passed **100 synthetic tests on each Python 3.12, 3.13 and 3.14**
using `uv run --python VERSION --locked python -m pytest -q` in the clean
snapshot. The optional image-sharing and manual Garmin adapters were **not**
integration-tested against their external services.

Node.js **20.20.2**, **22.23.4** and **24.22.2** each passed **29 Node tests**
against the clean installed frontend. Vite builds passed under Node 20 (Classic), Node 22 (Dashboard), and
Node 24 (Chinese-default Dashboard). The Chinese mobile UI probe passed
all checked interactions. Initial normal pnpm installation used Node 26.13.0;
the project engine range remains `^20.19.0 || ^22.13.0 || >=24`.

## Remaining gates before production

1. Confirm CI in the actual GitHub runner after the branch is reviewed and
   merged. Pip requirements and uv lock still resolve somewhat different
   transitive versions; evaluate a unified dependency policy in a separate
   batch rather than silently changing the credentialed sync workflow.
2. Run one explicitly authorized COROS sync and audit private archive backup
   first, sanitized JSON publication second, and Vercel's resulting build.
   Do not print original activity identifiers, precise GPS or credentials.
3. Verify the live Classic map's provider fallback, Lighthouse/Core Web
   Vitals and accessible navigation on relevant browsers. The Classic map
   still initializes a heavy Mapbox bundle even when the export has no GPS.
4. Historic PNGs removed from the current Git index remain reachable from
   previous commits/caches. No history rewrite, external deployment removal
   or fork detachment was performed here.

All checks above are local, non-mutating with respect to production systems.

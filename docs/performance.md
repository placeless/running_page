# Performance measurements and ablations

These findings concern the public Running Page fork, not the separate
Cloudflare application. Only public, privacy-validated activities and
**entirely invented** route coordinates were used.

## Measurement protocol

- Baseline: `review/batch-2-resilience` at `c29c544f`; candidate: Batch 3.
- Device/browser: local macOS, Firefox **159 Headless**, WebDriver BiDi.
- Production Vite build served over loopback HTTP **without gzip or network
  throttling**. JavaScript and total bytes below are browser
  `PerformanceResourceTiming.transferSize` for _same-origin_ resources.
  These numbers are **not** CDN-compressed bandwidth estimates.
- Viewports: 1280 × 900 (dark), 390 × 844 (light).
- Inputs: 957 already-public activities with no route geometry, and a separate
  in-memory fixture of 500 fully synthetic routes with privacy-style gaps.
- Fresh Firefox profiles were used for the matched cold scenarios. When
  testing several pages in one session, later pages share the HTTP cache:
  the resulting zero-byte warm requests cannot be compared with cold visits.
- First Contentful Paint (FCP) and Largest Contentful Paint (LCP) were sampled
  from Firefox. A single run does not establish statistical significance.
  INP needs trusted interaction samples; CLS, main-thread task cost,
  device memory, and mobile network throttling were not measured.

Reproduce the bundle check and a browser scenario after `npm run build`:

```sh
node scripts/performance/check-bundles.mjs
node scripts/performance/measure-browser.mjs \
  --dataset synthetic --page / --viewport desktop \
  --settle-ms 4800 --out /tmp/running-perf.json

# Confirm lazy world data arrives when scrolled into view:
node scripts/performance/measure-browser.mjs \
  --dataset public --page / --viewport mobile \
  --scroll-footprint --out /tmp/running-footprint.json
```

The browser runner needs Node ≥22 with global WebSocket and Firefox installed.
It uses an isolated temporary profile and loopback servers, modifies neither
the repository's public JSON nor the build, and outputs aggregate measurements.
Enabling the route fixture may request _public_ map styles and tiles from
Mapbox or CARTO; the synthetic coordinates are unrelated to any real athlete.

## Experiment A — conditional WebGL engines

Previously `RouteMapCanvas` statically imported both `mapbox-gl` and
`maplibre-gl`. Vite separated Mapbox into a vendor chunk but included the
entire MapLibre engine in the route canvas chunk, so both downloaded even if
only CARTO/MapLibre was used. The candidate uses provider-specific dynamic
imports and a small shared bounds implementation without an eager runtime
dependency on either renderer.

Cold synthetic-route Home, 1280 × 900, locally served, 500 routes:

| Browser measure            |      Before |       After | Interpretation                  |
| -------------------------- | ----------: | ----------: | ------------------------------- |
| JavaScript transfer        | 3,052,790 B | 1,310,744 B | **−57.1%**                      |
| Same-origin total transfer | 3,780,679 B | 2,038,633 B | **−46.1%**                      |
| FCP                        |      123 ms |      122 ms | No meaningful improvement shown |
| LCP                        |      452 ms |      451 ms | No meaningful improvement shown |
| WebGL map                  |     Created |     Created | No functional loss observed     |

The build's compressed sizes provide a separate transfer estimate:
`mapbox-gl` ~474 KB gzip; `maplibre-gl` ~273 KB gzip; the small
`RouteMapCanvas` module ~4.4 KB gzip. Actual bytes depend on the chosen
provider, fallback behavior, caching and the production CDN.

The baseline public Home (no routes) transferred ~266 KB JavaScript, and
the baseline Summary page fetched ~347 KB extra JavaScript when opened.
Neither is affected materially by this map change. The map engines were not
part of the no-route Home's initial static import graph.

Fallback validation:

- With a deliberately **invalid dummy Mapbox token**, the page switched to
  the CARTO / MapLibre basemap, created WebGL successfully, and ultimately
  fetched both engines (~2,982 KB JavaScript). This is a necessary fallback
  cost, not a regression or a claim about valid production credentials.
- With WebGL deliberately disabled using a BiDi preload script, the local map
  displayed the non-WebGL activity-list fallback instead of crashing the
  page. This unusual error path still loads the selected renderer; a separate
  WebGL preflight was rejected for now due to false-negative/context risks.
- A completed synthetic-route desktop screenshot showed the map, clusters,
  controls and activity panels. This is a rendering smoke check, not a
  pixel-diff test across browser engines.

## Experiment B — defer offscreen world boundary data

The mobile Home places `FootprintMap` ~2,685 px below the viewport top
(viewport height 844 px), yet its effect fetched a world GeoJSON immediately.
The map now starts that request only when approaching the viewport (300 px
root margin); on desktop, where the map begins at ~355 px, it still loads.

Cold public Home, mobile 390 × 844, light mode:

| Browser measure      |    Before |      After |
| -------------------- | --------: | ---------: |
| Same-origin transfer | 987,426 B |  679,119 B |
| Change               |         — | **−31.2%** |
| FCP                  |    114 ms |     115 ms |
| LCP                  |    442 ms |     432 ms |

After scrolling to the map, the browser fetched the deferred resource
(total transfer 987,875 B) and rendered **239 SVG paths**. No data was
removed, and the first desktop viewport still loads the map immediately.
The FCP/LCP variation is too small and too sparsely sampled to attribute to
the optimization.

## Ablation decisions and remaining evidence

**Retained:** conditionally loading the selected WebGL renderer and
viewport-gating the world GeoJSON, because both reduce measured transfer
without hiding map features. Automated Vite-manifest checks protect the
engine-splitting contract during CI builds.

**Not changed:** Recharts' page-lazy Summary bundle, worker clustering,
China-province lazy boundary chunk, and existing route-map visibility gate.
The source/build audit did not demonstrate enough runtime benefit to justify
rewriting those paths. No global module preload or preemptive map loading was
added.

**Not yet validated:** repeat-run LCP distributions, trusted INP
interactions, CLS, browser CPU profiles, cache-disabled mobile cold visits
under network throttling, Safari/Chromium comparisons, production CDN gzip
and cache headers, long-session WebGL memory/recovery, and live data-sync
timings. These need browser tooling and runtime access distinct from the
local source/build audit; no figures are invented for them.

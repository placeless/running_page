# Curated race records — explicitly approved public metadata

Activity names in the original Strava / COROS database are **private**:
the public exporter deliberately converts all activity names to their
generic sport names. Private titles can contain addresses, workplaces,
training partners, and other sensitive information. Do not remove that
privacy boundary to recover a race title.

## What the public website shows

The Dashboard distinguishes two concepts:

- **Fastest Matched Activities**: fastest _complete recorded activities_
  near standard distances. A recorded 4.332 km run is not automatically a
  complete 5K, and a 10.223 km run is not a certified 10K split.
- **Race Records**: a separate **manually reviewed** catalog of known race
  entries. It shows the event distance, recorded GPS distance, moving time
  and (only when verified and supplied) official race time.

The current approval is the user's confirmed **Rotary Club de Oviedo** 5K
event on **2025-11-09**. GPS distance is **4.3319 km**, device moving
time **16:19**. The official race time has **not** been supplied; the UI
displays **Not supplied**. 16:19 is **not** presented as an official 5K PB.

## Explicit-publication workflow

Edit **only** the reviewed file `src/static/races.json` when the athlete has
approved publishing a particular event. The approval is independent of the
daily COROS importer and the private database:

```json
{
  "version": 1,
  "races": [
    {
      "activity": {
        "date": "2025-11-09",
        "distance_m": 4331.9,
        "moving_time": "0:16:19"
      },
      "name": "Rotary Club de Oviedo — 5K",
      "race_distance_m": 5000,
      "official_time_seconds": null
    }
  ]
}
```

Only these fields may reach the public bundle:

| Property                | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `activity.date`         | Already-public, date-only selector                                                 |
| `activity.distance_m`   | Already-public GPS distance (meters)                                               |
| `activity.moving_time`  | Already-public moving time as exported                                             |
| `name`                  | Human-reviewed **event label**, never automatically copied from the private source |
| `race_distance_m`       | Advertised event distance (meters)                                                 |
| `official_time_seconds` | **Verified** official result duration, or `null` when unknown                      |

Selectors use date, GPS distance, activity type and moving time. They never
include private provider IDs or the sequential public `run_id`, which can
change when earlier activities are imported. Matching must be unique. If a
future sync alters the record, production builds fail until the approval
is reviewed again; the UI does not guess which run was the race.

Before an approval: confirm that the athlete wants **that specific event
and date** disclosed. Verify any official net/gun time using a race result;
device moving time is **not** official timing. The catalog deliberately
excludes full source titles, addresses, precise GPS, identity fields, bib
numbers and other unrelated metadata.

Validate before commit:

```sh
node scripts/validate-public-data.mjs
node scripts/validate-curated-races.mjs
node --test scripts/races.test.mjs scripts/release-safety.test.mjs
pnpm build
```

`vite.config.ts` enforces both the public-data privacy guard and curated
race validator in every production build. GitHub CI separately validates
both. The daily sync still commits only sanitized `activities.json`; it
neither reads private titles for approval nor rewrites the race catalog.

Use invented records for tests. The `pnpm dev:sample` fixture has no
approved races and therefore does not show the Race Records card.
The card is currently Dashboard-only; Classic is unchanged.

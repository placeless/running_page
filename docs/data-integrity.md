# Data integrity: private archive and published activity counts

The complete source of truth is the **private** `placeless/running-data-private`
archive, not the generated public JSON. The public dataset deliberately omits
precise GPS and recent activity dates. Do not interpret a smaller count as a
failed COROS sync without reconciling the export filters first.

## Reconciliation (2026-11-03)

Read-only SQLite inspection of the private archive at commit `e9c6126f`,
compared with the public snapshot and a regenerated privacy-safe export:

| Category                                                      | Records |
| ------------------------------------------------------------- | ------: |
| Archived SQLite activities                                    |     937 |
| Run / Walk / Hike / Ride with positive distance, before delay |     912 |
| Distance-free `WeightTraining` sessions                       |      15 |
| Distance-free `Workout` sessions                              |      10 |
| Recent runs deferred by the export's privacy delay            |       3 |
| **Correct public export at the audited cutoff**               | **934** |

Before this fix, `Generator.load()` applied `distance > 0.1` to _every_
activity type, inadvertently dropping all 25 distance-free training sessions.
It now preserves the recognized `Workout` and `WeightTraining` types
without admitting zero-distance running records. The public sport allowlist
preserves `WeightTraining` as a generic sport label, never a user-entered
activity name or address.

The three withheld runs were dated October 30, October 31 and November 2.
The exporter conservatively uses `delay_hours + 24` before comparing whole
calendar dates, since a date-only source cannot prove the activity's UTC
timestamp. These runs remain archived; subsequent successful scheduled
syncs will publish them after the configured hold.

Every positive-distance record eligible at the audited cutoff appeared in
the 909-record prior public snapshot; the revised 934-record preview
retained all of them and added exactly 25 training sessions. It contains
**no public route geometry**. In the older 909-record export, 34 records had
no reliable country/region, mostly because they lack GPS and the source
country label is untrustworthy. Unknown locations must remain unknown rather
than being guessed. Additional zero-distance training sessions can also
lack a geolocation.

## What this does **not** prove

- The archive itself may be missing COROS Training Hub activities. The
  scheduled downloader intentionally syncs COROS only **on or after
  2026-06-30** to avoid cross-provider duplicates with legacy Strava data.
  Exhaustive completeness requires a separate read-only provider activity
  listing, a stable-identity reconciliation, and a vetted backfill strategy.
  Do not simply remove `COROS_SYNC_SINCE`.
- The public dataset intentionally includes only coarse countries/provinces
  that can be classified from a stored route or trustworthy fallback. It
  will not represent all personal travel history or indoor exercise
  locations.
- Zero-distance workouts increase **activity frequency and training time**,
  not distance. Running-specific totals must continue to count only Run.

## Local verification (never publish private paths)

Use the ignored archive directory and **do not** print private activity
identifiers, GPS coordinates, routes, original names, or authorization data:

```sh
.venv/bin/python -m pytest -q test_generator.py test_privacy_export.py
.venv/bin/python run_page/privacy_export.py \
  --database private/archive-audit/data.db \
  --output private/public-preview.json
.venv/bin/python run_page/privacy_export.py --check private/public-preview.json
node scripts/validate-public-data.mjs private/public-preview.json
```

Verify the cutoff date and counts at each new export. Source database and
raw FIT files stay in the separately secured private archive. Never stage
`private/`, `run_page/data.db`, `FIT_OUT/`, or historic route SVGs.

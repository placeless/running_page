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

**Follow-up, 2026-11-03:** a manual run of the GitHub Actions COROS workflow
succeeded. It reported 96 activities in the configured date range, 96
previously downloaded FIT files, and no additional downloads. The privacy
cutoff advanced by one date and published the October 30 run; public JSON
grew from **934 to 935** without exposing GPS geometry. This verifies the
current export, but not provider completeness before the COROS cutoff.

## Missing COROS strength sessions: root cause and repair

The earlier SQLite reconciliation was incomplete: it proved every _existing
database_ entry was accounted for but did not reconcile all FIT files.
Independent inspection of all 96 COROS FIT files found **76 running** and
**20 strength-training** sessions. All 20 training FIT sessions had valid
timing information and no `total_distance` field. The legacy FIT parser
rejected missing distances, and the track loader also filtered zero-length
tracks. Consequently none of the 20 was in SQLite, despite successful
downloads and sync logs reporting no new files.

The import pipeline now explicitly accepts timed, zero-distance FIT Training
sessions, maps COROS `strength_training` to `WeightTraining`, preserves
their duration/heart rate, and keeps zero-distance running records excluded.
It compares GPS-less session dates against COROS's authoritative local
calendar day when available. For timestamps without GPS, the optional
`RUNNING_FIT_TIMEZONE` config controls the clock fallback; absent explicit
configuration, UTC is used rather than silently assuming Asia/Shanghai.
The owner-specific workflow sets `Europe/Madrid`. This is a _fallback_,
not a claim to know the timezone of workouts recorded while travelling.

Isolated replay against a **copy** of the 937-record private database
restored all 20 sessions, yielding **957 private records** and **955
privacy-safe public records** at the audited cutoff. Repeat import was
idempotent, and all public route fields remained empty. The original private
archive was not modified by the local replay.

**Production verification, 2026-11-03:** GitHub Actions Run Data Sync
(`41554716491`) completed successfully. Its COROS query found 96 activity
IDs and 96 existing FIT files; the updated importer loaded all **20**
previously skipped Training sessions and backed the corrected SQLite up to
the private archive. Independent read-only verification of the private
repository found **957 activities**, including **20 new WeightTraining**
sessions after the June 30 provider cutover. The public repository and
`m.placeless.net` both served **955 records**, including 35 total
WeightTraining sessions, with **zero route geometry**. For the 20 newly
imported sessions, day/type counts matched the isolated Europe/Madrid
replay exactly. The two October 31 and November 2 runs remain private under
the calendar-date publication delay; November 1 had no activity in either
the COROS FIT archive or the SQLite records.

## Publication delay and rolling COROS refresh (current policy)

The GitHub Actions workflow sets `RUNNING_PRIVACY_DELAY_HOURS=24`, overriding
only the publication delay in the private policy. Protected route zones,
privacy mode, and endpoint trimming are unchanged. The calendar-date
cutoff is `(now_utc - timedelta(hours=delay_hours + 24)).date()`,
which means a **48-hour cutoff offset** rather than exact per-activity
release timing. A successful scheduled sync and Vercel deployment must
still occur before the latest eligible date appears on the website.

The workflow sets `COROS_REFRESH_RECENT_DAYS=7`. Every sync queries the
full COROS activity index since the provider cutover, downloads newly
discovered activities and **refreshes already-cached FIT files from the
latest seven calendar dates**. Replacements are atomic: a failed download
does not destroy a cached original. The importer explicitly re-processes
successfully refreshed files and updates existing activity records by
their stable timestamp-derived IDs, including corrected local dates.
The imported-file manifest is deduplicated, and older unchanged FITs
remain cached. The `2026-06-30` cutover remains in place to avoid
cross-provider duplicate records.

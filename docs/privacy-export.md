# Public running data: privacy-first export

`running_page` is a public website. Anything in its JavaScript, JSON, SVG,
GitHub history or deployment artifacts must be treated as publicly recoverable.
Zoom, route clustering, a hidden UI layer and a private Mapbox token do **not**
conceal GPS coordinates present in a browser-downloaded JSON file.

## Data boundary

| Source                                         | Ownership             | Permitted in the public repo? |
| ---------------------------------------------- | --------------------- | ----------------------------- |
| COROS credentials, raw FIT, GPX, TCX           | Private archive       | **No**                        |
| Original `run_page/data.db`                    | Private archive       | **No**                        |
| `private/privacy.json` (home/work/other zones) | Private configuration | **No**                        |
| Validated `src/static/activities.json`         | Public export         | Yes                           |
| Code, non-sensitive map boundaries and tests   | Public repository     | Yes                           |

During the November 2026 cutover, the original database, FIT files, import
manifest, historical public JSON and 31 generated SVGs were backed up in
`placeless/running-data-private` (private). The public Git index was then
cleared of the originals and 29 personally generated SVGs; only generic
`assets/start.svg` and `assets/end.svg` remain. The Fork's public
`master` history was rewritten on 2026-11-03 to remove historical
personal GPS objects; cached GitHub SHA links remain subject to
GitHub Support's separate removal process.

The Python exporter `run_page/privacy_export.py` is the only supported route
from the private database to public activity JSON. The COROS and Strava sync
entry points call it after updating the private database. The exported record
uses an allowlist: date without time, generic activity name, no provider ID or
raw address, optional redacted route segments, and existing activity metrics.
The exporter postpones publication by `delay_hours` (default 72); it also
accounts conservatively for unknown source timezone when using local dates.
This fork's GitHub Actions workflow now sets
`RUNNING_PRIVACY_DELAY_HOURS=0`, publishing every activity available
through the current UTC date on each successful sync, without a publication
hold. The environment override changes **only** the delay; it retains the
private Secret's route mode, protected zones and endpoint trimming.
Positive delay settings remain supported and conservatively include an
extra 24-hour margin when comparing date-only activities.

**Missing private policy means aggregate-only output, with no GPS.** Enabling
GPS requires an explicit private file with one or more protection circles.
The exporter clips start and end portions of each route, removes _all_ points
and crossing segments around protected places, and writes each resulting
visible section separately in `route_segments`. `summary_polyline` contains
only the longest approved section for legacy consumers. Nothing joins two
sections across a hidden place; the dashboard map and track thumbnails render
each approved part independently. The track wall groups similar visible route
shapes conservatively and retains explicit access to every activity in a group.
If WebGL fails, the map-local fallback exposes a list of the already-public
activities instead of unmounting the rest of the page.
The original recorded distance and duration remain unchanged, even when map
geometry is reduced.

The 2026-11-03 data-integrity reviews found two separate exclusion bugs:
25 zero-distance activities already present in SQLite were omitted from the
public export, and another 20 COROS Training FIT files had never been
imported into SQLite. See [data-integrity reconciliation](data-integrity.md)
for the before/after counts, timezone handling, and privacy cutoff.

## Configure locally without revealing locations

1. Keep the original private database and FIT exports backed up outside the
   public repository. The ignored `private/` folder is for _local configuration_,
   not a durable backup.
2. Create `private/privacy.json` (the directory is excluded by `.gitignore`):

   ```json
   {
     "version": 1,
     "mode": "routes",
     "delay_hours": 72,
     "start_end_meters": 700,
     "zones": [{ "latitude": null, "longitude": null, "radius_m": 700 }]
   }
   ```

   **Replace both `null` placeholders** with the center of your sensitive
   location. The example intentionally fails validation until you do. Add
   separate circles for other private destinations. Always assess nearby
   roads, repeat passes, short loops and route intersections; a fixed radius
   alone cannot guarantee that an observer cannot infer your home. The
   700-meter values are starting points for review, not absolute guarantees.

3. Test a _temporary_ export before touching the tracked JSON:

   ```sh
   export RUNNING_PRIVACY_CONFIG=private/privacy.json
   .venv/bin/python run_page/privacy_export.py \
     --database run_page/data.db --output /tmp/running-public-preview.json
   .venv/bin/python run_page/privacy_export.py \
     --check /tmp/running-public-preview.json
   node scripts/validate-public-data.mjs /tmp/running-public-preview.json
   ```

4. Review the output and visually inspect each known sensitive location. Then
   export to `src/static/activities.json`, run the checks and build normally:

   ```sh
   .venv/bin/python run_page/privacy_export.py \
     --database run_page/data.db --output src/static/activities.json
   .venv/bin/python run_page/privacy_export.py \
     --check src/static/activities.json
   pnpm build
   ```

   Until this is done, **every production build fails** on older, unsafe
   activity JSON. There is no environment-variable bypass; use a separate
   local development preview and privacy-safe synthetic fixtures instead.

## Move the raw database to a durable private GitHub repository

The public repository historically carried raw FIT and SQLite files.
The private archive and an independent verification clone were checked
before an explicitly approved, `--force-with-lease`-guarded cleanup of the
Fork's public `master` on 2026-11-03. Old SHA URLs may remain cached on
GitHub; see the separate support action below.

The new automated workflow requires a **new, non-forked private** repository
containing `data.db`, `FIT_OUT/` and any existing `GPX_OUT/`, `TCX_OUT/`,
`activities/` and `imported.json` data. Configure these settings on the
_public_ GitHub repository:

| Setting                       | Type             | Value                                                                                   |
| ----------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `RUNNING_PRIVATE_REPOSITORY`  | Actions variable | `placeless/running-data-private`                                                        |
| `RUNNING_PRIVATE_DEPLOY_KEY`  | Actions secret   | Unencrypted SSH private key for the _single private archive_ deploy key (write enabled) |
| `RUNNING_PRIVACY_POLICY_JSON` | Actions secret   | Full content of the private JSON policy                                                 |

The workflow pins the archive name and uses its repository-scoped SSH Deploy
Key. A Deploy Key cannot access other repositories and is preferable to a
broad personal token. Check repository visibility periodically; the workflow
does **not** independently verify the remote visibility flag. Raw files were
removed from the public Git **index only**, retaining working files on disk.
The new workflow refuses to sync if any legacy raw files remain tracked. Its
publication step stages only `src/static/activities.json`, never uses
`git add .`, and backs up new raw FIT/SQLite data to the private repository
before committing the sanitized public JSON.

The Fork `master` rewrite and deletion of nine unsafe retained Vercel
deployments were completed separately on 2026-11-03. Neither operation
automatically deletes GitHub cached commit URLs, old clones, locally saved
archives, or files already downloaded by third parties. Data distributed
earlier cannot reliably be recalled. See [Git history remediation and
remaining GitHub Support work](history-remediation.md).

## Limits and verification

- The public app still exposes your chosen dates, distances, route fragments,
  countries, regions and race statistics. These can be combined with outside
  information. A protected-zone gap may itself reveal the _approximate_
  area of a sensitive place; use aggregate-only output if that is unacceptable.
- The private policy must contain **all** sensitive zones, not only the start
  or end of a run. Reassess it when travel or living arrangements change.
- The old `IGNORE_START_END_RANGE`/`IGNORE_POLYLINE` mechanism is not an
  adequate replacement for this exporter. It deletes points, not line edges.
- `python run_page/privacy_export.py --check` verifies zone intersections
  against the **private** policy; the JavaScript build guard independently
  checks the public schema and rejects legacy raw JSON. The browser never
  receives the private policy.
- Generated map/route screenshots and separately published SVGs still require
  an explicit privacy audit. Automatic public SVG generation has been disabled;
  only allowlisted activity JSON is auto-committed.
- Vite's legacy `assets/index.tsx` uses `import.meta.glob`. Even **ignored**
  personal SVGs left in the local `assets/` folder would be bundled during
  a local production build. The build guard now blocks this case; store old
  generated graphics in an ignored `private/` folder outside `assets/`.

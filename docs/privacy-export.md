# Public running data: privacy-first export

`running_page` is a public website. Anything in its JavaScript, JSON, SVG,
GitHub history or deployment artifacts must be treated as publicly recoverable.
Zoom, route clustering, a hidden UI layer and a private Mapbox token do **not**
conceal GPS coordinates present in a browser-downloaded JSON file.

## Data boundary

| Source | Ownership | Permitted in the public repo? |
| --- | --- | --- |
| COROS credentials, raw FIT, GPX, TCX | Private archive | **No** |
| Original `run_page/data.db` | Private archive | **No** |
| `private/privacy.json` (home/work/other zones) | Private configuration | **No** |
| Validated `src/static/activities.json` | Public export | Yes |
| Code, non-sensitive map boundaries and tests | Public repository | Yes |

During the November 2026 cutover, the original database, FIT files, import
manifest, historical public JSON and 31 generated SVGs were backed up in
`placeless/running-data-private` (private). The public Git index was then
cleared of the originals and 29 personally generated SVGs; only generic
`assets/start.svg` and `assets/end.svg` remain. Historical Git commits still
contain the originals until a separate history cleanup.

The Python exporter `run_page/privacy_export.py` is the only supported route
from the private database to public activity JSON. The COROS and Strava sync
entry points call it after updating the private database. The exported record
uses an allowlist: date without time, generic activity name, no provider ID or
raw address, optional redacted route segments, and existing activity metrics.
The exporter postpones publication by `delay_hours` (default 72); it also
accounts conservatively for unknown source timezone when using local dates.

**Missing private policy means aggregate-only output, with no GPS.** Enabling
GPS requires an explicit private file with one or more protection circles.
The exporter clips start and end portions of each route, removes *all* points
and crossing segments around protected places, and writes each resulting
visible section separately in `route_segments`. `summary_polyline` contains
only the longest approved section for legacy consumers. Nothing joins two
sections across a hidden place; the dashboard map renders all approved parts.
The original recorded distance and duration remain unchanged, even when map
geometry is reduced.

## Configure locally without revealing locations

1. Keep the original private database and FIT exports backed up outside the
   public repository. The ignored `private/` folder is for *local configuration*,
   not a durable backup.
2. Create `private/privacy.json` (the directory is excluded by `.gitignore`):

   ```json
   {
     "version": 1,
     "mode": "routes",
     "delay_hours": 72,
     "start_end_meters": 700,
     "zones": [
       { "latitude": null, "longitude": null, "radius_m": 700 }
     ]
   }
   ```

   **Replace both `null` placeholders** with the center of your sensitive
   location. The example intentionally fails validation until you do. Add
   separate circles for other private destinations. Always assess nearby
   roads, repeat passes, short loops and route intersections; a fixed radius
   alone cannot guarantee that an observer cannot infer your home. The
   700-meter values are starting points for review, not absolute guarantees.
3. Test a *temporary* export before touching the tracked JSON:

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

   Until this is done, the **normal production build deliberately fails** on
   the older, unsafe activity JSON. `RUNNING_ALLOW_UNSAFE_LOCAL_PREVIEW=1 pnpm
   build` is available strictly for local debugging. Never configure that
   bypass on Cloudflare, CI or a public deployment.

## Move the raw database to a durable private GitHub repository

The public repository still has legacy raw FIT and SQLite files in its
**history**. The new private archive and an independent verification clone have
been checked against the original files. Do not rewrite public Git history
without separately assessing the consequences of a force push.

The new automated workflow requires a **new, non-forked private** repository
containing `data.db`, `FIT_OUT/` and any existing `GPX_OUT/`, `TCX_OUT/`,
`activities/` and `imported.json` data. Configure these settings on the
*public* GitHub repository:

| Setting | Type | Value |
| --- | --- | --- |
| `RUNNING_PRIVATE_REPOSITORY` | Actions variable | `placeless/running-data-private` |
| `RUNNING_PRIVATE_DEPLOY_KEY` | Actions secret | Unencrypted SSH private key for the *single private archive* deploy key (write enabled) |
| `RUNNING_PRIVACY_POLICY_JSON` | Actions secret | Full content of the private JSON policy |

The workflow pins the archive name and uses its repository-scoped SSH Deploy
Key. A Deploy Key cannot access other repositories and is preferable to a
broad personal token. Check repository visibility periodically; the workflow
does **not** independently verify the remote visibility flag. Raw files were
removed from the public Git **index only**, retaining working files on disk.
The new workflow refuses to sync if any legacy raw files remain tracked. Its
publication step stages only `src/static/activities.json`, never uses
`git add .`, and backs up new raw FIT/SQLite data to the private repository
before committing the sanitized public JSON.

This migration does **not** delete historical Git objects, fork copies,
published Cloudflare deployments, downloaded archives or caches. History
rewriting and deployment purge are a later, explicitly reviewed operation.
Data that has already been distributed cannot be reliably recalled.

## Limits and verification

- The public app still exposes your chosen dates, distances, route fragments,
  countries, regions and race statistics. These can be combined with outside
  information. A protected-zone gap may itself reveal the *approximate*
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

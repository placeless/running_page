# Maintaining the placeless fork

This repository tracks [yihong0618/running_page](https://github.com/yihong0618/running_page)
while retaining personal activity data and deployment settings. The remotes
are `origin` (placeless) and `upstream` (yihong0618).

## Updating from upstream

Do not synchronize the fork with GitHub's overwrite/sync button. It can lose
local modifications, generated files or conflict resolutions. Merge and
validate upstream changes on a review branch instead:

```sh
git status --short                 # must be clean
git fetch origin master
git fetch upstream master
git switch master
git merge --ff-only origin/master  # catch up with automated data commits
git switch -c maintenance/upstream-YYYY-MM
git merge upstream/master
```

During conflict resolution, retain the **fork's** versions of
`src/static/activities.json` and generated `assets/*.svg`. Deleted
historical SVGs do not need to be restored; the data generator creates
current assets. Keep `run_page/data.db` and all activity exports. For source
conflicts, adopt the upstream code structure and reapply personal behavior in
`src/themes/classic/`, `config.yml`, and
`.github/workflows/run_data_sync.yml`. Do not reintroduce deleted pre-3.0
component paths.

Review `git diff --check`, `pnpm install --frozen-lockfile`,
`pnpm run build`, and applicable Python checks. Then open a PR from the
maintenance branch against `master`. Merge only after verifying routes,
yearly statistics, map rendering and the generated activity data.

The fork defaults to `classic` so an upstream theme redesign does not
silently replace the deployed experience. Change `theme_preset` in
`config.yml` deliberately. `config.yml` deliberately contains **no** Mapbox
token: supply `VITE_MAPBOX_TOKEN` in the frontend build environment instead.
GitHub Actions builds can obtain it from the `MAPBOX_TOKEN` repository secret;
Cloudflare builds require that environment variable to be configured **in
Cloudflare separately**. Restrict the token's allowed origins in Mapbox.

## Run Data Sync: COROS (November 2026 cutover)

The fork uses the upstream COROS Training Hub downloader, **not** the Strava
API. `.github/workflows/run_data_sync.yml` selects `RUN_TYPE: coros`; its
scheduled run remains daily. The downloader fetches FIT recordings and merges
them into `run_page/data.db` and `src/static/activities.json`, which the
Cloudflare-hosted frontend consumes after its existing Git deployment rebuild.
No Cloudflare Worker, D1 database, Strava subscription or Strava OAuth token is
needed to perform this sync.

### One-time setup (GitHub)

In the **placeless/running_page** repository, go to **Settings → Secrets and
variables → Actions → New repository secret** and create:

- `COROS_ACCOUNT`: COROS Training Hub login (email/account).
- `COROS_PASSWORD`: your COROS account's **raw password**. The Python script
  performs COROS's expected MD5 conversion locally before calling its login
  endpoint. Do not pre-hash the secret.

Credentials must be GitHub Actions Secrets, not checked into the repository,
not stored in `config.yml`, and not supplied as shell command arguments in
CI. You can run locally without exposing the password in shell history:

```sh
read -r COROS_ACCOUNT
read -rs COROS_PASSWORD; echo
export COROS_ACCOUNT COROS_PASSWORD
python run_page/coros_sync.py --since 2026-06-30
unset COROS_ACCOUNT COROS_PASSWORD
```

The local database currently contains **861** Strava activities (836 with
positive distance appear in the frontend JSON). Its last activity starts on
**2026-06-29**. The `COROS_SYNC_SINCE: '2026-06-30'` cutoff deliberately prevents
duplicate activities from different providers' unrelated IDs. To backfill
earlier dates, first develop and validate a cross-provider deduplication plan;
simply removing `--since` will double-count some workouts. FIT exports are
cached in `FIT_OUT/` to avoid re-downloading known IDs.

The upstream downloader uses undocumented Training Hub endpoints. This fork
checks the EU, global and CN region hosts by probing authenticated activity
access rather than assuming the region from successful login alone. Any
unrecognized activity-list response or download transport failure fails the
workflow instead of publishing an apparently successful but empty sync.
Individual activities without an available FIT export are reported/skipped.

### Activate and verify

Merge the maintenance branch to **master** and create both secrets before
running **Actions → Run Data Sync → Run workflow** on `master`. Check that the
COROS region is selected, activities are downloaded, and a new run exists in
the output without duplicates around the cutoff. The workflow commits data to
the repository if it changed; the GitHub-connected Cloudflare deployment
should then rebuild with the updated `src/static/activities.json`.

Unchanged stats after a successful run may mean the COROS account has no
activity at/after the cutoff, the new sport has no FIT export, or deployment
did not pick up the committed data. Check the action log and generated JSON
before changing the cutoff. Keep the old Strava secrets until the COROS
integration has been validated; they are unused in the COROS branch.

### Historical incident: Strava 403 / Application Inactive

The 2026-11-02 workflow failed while fetching activities:

```text
403 Forbidden: Application / Status / Inactive
```

This is **not** an expired refresh token: the OAuth refresh succeeded first.
Since June 2026, Strava requires the owner of a Standard Tier API application
to have an eligible active Strava subscription. The **account owning the API
application**, not merely an authorized athlete, must qualify.

1. Sign in with the Strava account that owns the application at
   https://www.strava.com/settings/api.
2. Confirm an eligible subscription and reactivate the existing app in the
   API Settings dashboard. Check the app status, not just the access token.
3. Re-run **Actions → Run Data Sync → Run workflow**. If the same application
   was reactivated, the existing GitHub Actions secrets may remain valid.
   If a new app is created, update `STRAVA_CLIENT_ID`,
   `STRAVA_CLIENT_SECRET` and a freshly authorized
   `STRAVA_CLIENT_REFRESH_TOKEN` in repository Actions secrets.

If you do not want to reactivate the Strava app, choose another supported
data source **only after checking data coverage**. The upstream
`intervals_icu` integration uses `INTERVALS_ICU_ATHLETE_ID` and
`INTERVALS_ICU_API_KEY`; it is not a drop-in replacement for historical
Strava data. The `strava_web` route uses an authenticated web-session cookie,
which has different security and stability risks; do not switch to it
unattended.

Do not disable workflow failures with `continue-on-error`: a successful
sync run must mean that its selected data source actually succeeded.
Scheduled runs failed while `RUN_TYPE: strava` remained selected. With COROS
selected, this no longer blocks new activity imports.

References:

- https://developers.strava.com/docs/getting-started/
- https://communityhub.strava.com/developers-api-7/code-inactive-on-all-new-requests-13620
- https://github.com/yihong0618/running_page/discussions/1126

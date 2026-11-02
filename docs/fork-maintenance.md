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
`config.yml` deliberately. The Mapbox public token is in that file; restrict
its allowed origins in the Mapbox dashboard or supply `VITE_MAPBOX_TOKEN`
at build time.

## Run Data Sync: Strava 403 / Application Inactive

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
Scheduled runs will continue failing until the external application is
reactivated or the configured source is changed.

References:

- https://developers.strava.com/docs/getting-started/
- https://communityhub.strava.com/developers-api-7/code-inactive-on-all-new-requests-13620
- https://github.com/yihong0618/running_page/discussions/1126

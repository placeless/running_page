# Public Git history: privacy-remediation record

**State: GitHub Fork `master` rewritten on 2026-11-03 with explicit approval;
nine risky Vercel deployments removed earlier. GitHub's old-commit cached
views still require Support review.**
This is specific to `placeless/running_page`, not to the independent
`placeless.net/running/` application or the upstream repository.

## Verified inventory (2026-11-02)

The public Git index contains no tracked FIT/GPX/TCX, database, import
manifest or personalized generated SVG. At the beginning of this audit,
`src/static/activities.json` contained 909 records with no route geometry.
The first corrected November 3 publication contained **934**, and a
subsequent successful COROS sync published **935**, still with no route
geometry. A local build audit also identified 29 ignored
generated SVGs that Vite's legacy glob imported into `dist/`; they were moved
into a local ignored `private/` folder, and the build guard was hardened to
reject reappearance. Historical Vercel deploys and the Fork's `master`
history were subsequently remediated as detailed below.

## Executed GitHub migration (2026-11-03)

After backing up the private archive and making an ignored **640 MiB**
offline Git bundle, the reviewed snapshot was restored to a fresh isolated
clone using a single fork-range `git-filter-repo` pass. The immutable shared
upstream merge-base `3bec7208` was preserved.

| Evidence                                                                                                 | Result                                                                |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Old `placeless/running_page` HEAD                                                                        | `77244ec0`                                                            |
| Rewritten `master` pushed to **origin only**                                                             | `b32ef746`                                                            |
| Approved paths, mode and byte comparison                                                                 | **217**, no differences                                               |
| Original fork-range candidate-sensitive objects                                                          | 3,424                                                                 |
| Old candidate-sensitive objects reachable from the new `master`, excluding approved current public blobs | **0**                                                                 |
| Privacy-checked public activities                                                                        | **934**; zero route geometry                                          |
| Python tests / TypeScript / Vite / ESLint                                                                | **56 passed** / pass / pass / pass                                    |
| Remote branches / PRs / direct child forks                                                               | 1 / 0 / 0                                                             |
| Push safety                                                                                              | Explicit `--force-with-lease` against the old SHA; upstream untouched |

The working checkout was reset to the new `origin/master` **after preserving
its previous local edits**. Existing legacy local branches and old clones
must not be merged into the cleaned branch: they can reintroduce confidential
objects. The offline bundle is retained only under Git-ignored `private/`
for emergency recovery and must **never** be uploaded to any public repo.

**Remaining server-side exposure:** after the rewrite, GitHub's Commit API
still resolved a sampled former Fork commit whose historical source
included private route geometry. Its SHA is intentionally **not documented
in this public repository** to avoid directing readers to sensitive data.
This is expected for cached views on GitHub:
a branch update by itself does not purge all SHA-addressable objects.
The repository owner must ask [GitHub Support](https://support.github.com/)
to evaluate cached-view removal and server-side garbage collection under
GitHub's [sensitive-data procedure](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
There are **zero affected pull requests** and **zero direct child forks** by
the current repository API audit. Do not include raw coordinates, credentials,
or private files in the support request. Support assistance is discretionary.

| Read-only finding                                                      |                                        Result |
| ---------------------------------------------------------------------- | --------------------------------------------: |
| Local `master` history                                                 |                                 1,825 commits |
| Fork-specific commits relative to `upstream/master`                    |                                           550 |
| Distinct GPS/database paths touched by fork-only commits               |                                            96 |
| Distinct generated route SVG paths touched by fork-only commits        |                                            20 |
| Distinct GPS/database paths touched anywhere in local `master` history |                                           137 |
| GitHub repository                                                      |      Public Fork of `yihong0618/running_page` |
| Direct child forks / PRs                                               |                            0 / 0 (GitHub API) |
| GitHub Actions caches                                                  | 9; keys appear to be Node/Python dependencies |
| GitHub Actions artifacts / Releases / GitHub Pages site                |                        0 / 0 / not configured |

Path counts represent distinct names found in Git logs, **not** confirmed
personal route files or the count of historical blobs. Shared upstream
ancestry also touched GPS and generated graphics paths. The audit did not
extract, display, or distribute historical GPS coordinates.

## Why a blanket rewrite is unsafe

The local merge-base with `upstream/master` is `3bec7208` as of the audit.
Shared upstream commits must not be rewritten as though they were all
fork-originated private data. A global `git filter-repo --invert-paths` across
every ref could change common commit IDs, making future merges from upstream
unnecessarily difficult. Conversely, rewriting only the latest commit does
not remove an older sensitive blob reachable through its parent history.

The current public JSON is safe but its historical versions may not be. A
cleanup must remove unsafe historical versions **without losing the validated
current export**. Embedded historical data may also have appeared in generated
SVGs, build artifacts, committed configuration (including encoded points),
and commit messages; path extension matching alone is insufficient.

## Isolated partial-rewrite trial (2026-11-02)

### Successful one-pass trial (basis for migration)

Following the second-pass regression documented below, a **fresh**
non-hardlinked clone was created with only `master` and **no remote**. One
`git-filter-repo` call targeted only `3bec7208..master`, removing the
historical private paths listed below **plus `src/utils/const.ts`**. That
last path had carried a literal Mapbox `pk.` public browser token in
earlier Fork-specific commits, but is absent from the approved current tree.
No second filter invocation was made.

An independent Git index was populated from the current public source tree:
the 214 tracked public files and the two new public operational documents.
The resulting Git tree was committed as a snapshot to the isolated rewritten
history. Both file contents **and Git modes** were compared with the approved
snapshot, including the one tracked symlink. The result is reproducible
without replacing the upstream shared ancestor.

| Validation                                                                                                         | Single-pass candidate                    |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Shared upstream merge-base                                                                                         | `3bec7208`, unchanged                    |
| Fork-specific commits before / after filtering                                                                     | 550 / 20                                 |
| Fork-specific commits after approved snapshot commit                                                               | 21                                       |
| Approved latest paths                                                                                              | 216 (0 missing, 0 extra)                 |
| Path content or Git file-mode differences                                                                          | **0**                                    |
| Old named candidate-sensitive object IDs                                                                           | 3,424                                    |
| Previously identified candidate-sensitive object IDs still reachable, apart from two approved current public blobs | **0**                                    |
| Public JSON check                                                                                                  | 909 activities, with no route geometries |
| TypeScript, Vite, Prettier, ESLint, Python tests                                                                   | Pass; 54 Python tests                    |
| Bundled legacy personal SVG JavaScript chunks                                                                      | 0                                        |

The content-oriented screening inspected 124 eligible historical text blobs
in the Fork-specific revision range and 114 in the rewritten candidate.
Eight historical blob versions containing a Mapbox public `pk.` token were
all associated with `src/utils/const.ts`; none appeared in the rewritten
Fork-specific text scan. No matching `sk.`-shaped private token or
high-precision decimal coordinate pair appeared in either scan. README
credential-shaped literals were also present in the unmodified upstream
README, not new Fork-specific secrets. **These are bounded pattern checks,
not exhaustive credential or geographic-content verification**: private GPS
binary and historical activity JSON files were intentionally excluded from
the text scan and instead removed by the path/object-reachability filter.

This trial superseded the earlier two-pass experiment. Its final migration
successor was revalidated against the 217-file approved snapshot, then pushed
to the Fork's own `master` after a separate authorization.

### Earlier exploratory trial (superseded)

An independent, non-hardlinked local clone of `master` was created outside
the working repository. The test clone's `origin` remote was removed after
the trial to eliminate any possibility of an accidental push from it.
No refs in the actual repository or on GitHub were changed.

The trial ran `git-filter-repo` **only** over the range
`3bec7208..master` using `--refs`, `--invert-paths` and a manifest of
private paths. The manifest covered raw FIT/GPX/TCX and activity folders,
SQLite databases, `imported.json`, historical activity JSON, generated
personal SVGs, the sync workflow (including a legacy encoded-polyline setting)
and `config.yml`. The shared
upstream commit `3bec7208` remained unchanged.

| Validation                                                                                                       | Isolated trial result                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Fork-only commits before rewrite                                                                                 | 550                                                                    |
| Fork-only commits immediately after filtering                                                                    | 22                                                                     |
| Additional safe restoration and removal commits                                                                  | 2                                                                      |
| Paths still present after filtering and needing a new removal commit                                             | 23 (4 activity/source files and 19 generated SVGs)                     |
| Original potentially sensitive path objects from the Fork-specific range                                         | 3,416 distinct Git object IDs                                          |
| Such objects reachable from the proposed new `master`, excluding the two validated current public snapshot blobs | **0**                                                                  |
| Current publicly tracked file content compared with the working source                                           | 216 paths, no differences                                              |
| Privacy index and public JSON checks                                                                             | Pass; 909 public activities, zero route geometries                     |
| TypeScript / Vite build / Python regression suite                                                                | Pass / Pass / 54 passed                                                |
| Isolated clone after removing obsolete remote ref, expiring reflogs and running Git GC                           | One `master` ref, `git fsck` clean, packed data 646.48 MiB → 45.88 MiB |

The 23 residual paths illustrate a critical limitation: **restricting the
rewrite to the Fork range does not erase files inherited from shared
history**. The trial created a distinct commit to remove them from the
latest tree. Their historical upstream objects remain accessible through the
unchanged common ancestor, which must be evaluated separately from this
Fork's personal history. An audit of known path objects is also not proof that
every historical text or binary blob is free of embedded sensitive data.

One additional content check found the old workflow's `IGNORE_POLYLINE`
value in four Fork-specific `README.md` blobs. Comparison against the
unmodified upstream merge-base confirmed this was **already an upstream
documentation example**: the old Fork workflow used exactly the same
encoded value, with no Fork-specific variation in its workflow history. It
must not be mislabeled as this user's private location. Other historically
embedded coordinates or credentials still require a separate review; the
known-path object check does not certify all arbitrary text.

The resulting test `master` is a **candidate**, not a push-ready migration:
GitHub cached old commit URLs and Vercel previous deploy artifacts cannot
be cleared by changing the local branch, and the original on-disk checkout
still contains the old historical Git objects. Before publication, repeat
the trial against a freshly fetched, frozen remote `master` and audit all
accessible refs and embedded sensitive strings. Upstream merges may restore
removed sample assets; the public build guard is expected to reject them.

### Follow-on trial: partial-rewrite regression

A second isolated clone (`candidate-refined`) applied another partial
`git-filter-repo` pass to the formerly used `src/utils/const.ts` path.
The older Fork-only history had included a Mapbox `pk.` public browser
token in that file; a public token is not a server secret, but historical
versions are still discoverable and should be origin-restricted or rotated
as appropriate.

Despite zero occurrences of this path in the _rewritten Fork-only object
range_, the second pass restored `src/utils/const.ts` to the latest file
tree. The second candidate contained **217 tracked files** instead of the
approved 216. The index privacy guard did not reject it: it checks private
source formats and generated assets, not historical public Mapbox tokens.
This second candidate is **rejected** and must not be pushed. The original
first-pass candidate remains isolated and unchanged.

**New required release invariant:** after _every_ filter invocation,
compare the **entire latest tracked path set and file contents** against
the approved 216-file public snapshot before proceeding to tests.
Then examine old-blob reachability and clean the inherited latest tree
again if needed. Verifying only the rewritten range or passing the
existing JSON/index validators is not sufficient. No claim is made that
all embedded historical credentials or coordinates have been inspected.

## External publication surfaces (read-only assessment)

- **GitHub:** the fork is public and has only one advertised branch,
  `master`; the GitHub API previously reported no child forks, PRs,
  artifacts or releases. Nine Actions caches observed on 2026-11-02 were
  dependency caches named for `setup-python` and `node-cache`, not the
  former raw-running-data cache prefix. These names alone cannot prove that
  every cached archive is free of sensitive content. Do not delete caches
  without a separate audit.
- **Cloudflare, verified 2026-11-03:** Wrangler OAuth was renewed and
  account-level Pages and Worker Routes were inspected read-only. The Pages
  project `placeless-github-io` owns `placeless.net` and is connected to
  `placeless/placeless.github.io`. The path `placeless.net/running*` is
  assigned to the separate Worker `placeless-running`, with a separate
  Pages project connected to `placeless/running`. **Neither Pages project
  hosts the `running_page` dashboard at `m.placeless.net`.** That hostname
  responds with `x-vercel-id` and `x-vercel-cache` headers, confirming a
  Vercel origin behind Cloudflare. DNS Records API access returned HTTP 403,
  so the exact Cloudflare DNS record was not audited. Do not delete Pages
  deployments of either unrelated application as part of this migration.
- **Vercel production (account-verified 2026-11-03):** the Vercel CLI
  confirmed `placeless-projects/running-page`, connected to this fork's
  `master` branch with `m.placeless.net` as its production domain.
  The `ssoProtection.deploymentType` setting is
  `prod_deployment_urls_and_all_previews`: independent production
  deployment URLs and all previews require Vercel Authentication.
  The pre-cleanup account inventory contained **12 READY production deployments**
  (nine from November 2 and three from June 26–30). **All 12 deployment
  URLs redirected anonymous HEAD requests to Vercel Authentication.**
  The retention policy is 30 days, minimum 10 retained deployments;
  the three June deployments still existed despite this policy. GitHub's
  **549 deployment records** are historical metadata, not 549 live builds.

  The previous public `activities.json` contained 909 aggregate records;
  there was no GPS geometry or time-of-day. Comparing each retained deployment's
  source commit found **three newer builds** with zero public GPS polylines
  and zero personal SVGs, and **nine legacy builds** pointing to commits
  with 799–876 GPS polylines and 12–29 generated personal SVGs.
  This classification is based on historical Git content; the Vercel file
  tree endpoint returned 404 for a Git-sourced historical deployment, so
  the deployed byte-for-byte asset content has not been inspected.
  The nine legacy deployments were removed following explicit
  authorization, preserving the current production deployment.
  Deployment IDs and source-risk counts are recorded in the local ignored
  `private/vercel-deployment-privacy-audit.json` inventory; do not publish it.
  Following approval, Vercel's deletion endpoint returned `DELETED` for
  each of the nine targets. An account-level follow-up returned precisely
  the three expected clean deployments, with none of the nine old IDs
  remaining. At that checkpoint, the production target still pointed to commit
  `77244ec0` and retains the `m.placeless.net` alias. The domain returned
  HTTP 200 after cleanup; a checked deleted deployment URL returned 404.

- **GitHub cache retention:** changing `master` does not necessarily
  remove old SHA-linked views, PR references or historical cached objects.
  Follow GitHub's official sensitive-data procedure after an authorized
  rewrite, including evaluating Support assistance. GitHub does not
  promise such help for data that it does not classify as sensitive.

The Vercel cleanup and Fork `master` migration completed on 2026-11-03,
as separate explicitly approved operations. Full historical embedded-content
verification remains bounded by the described scans. GitHub cached views,
local legacy refs, and downloaded third-party copies have **not** been purged
by rewriting the active branch.

## Source data reconciliation before the history rewrite (2026-11-03)

The current private archive contains **937** activities, not merely the
previously published 909. The source loader dropped 25 zero-distance
Workout/WeightTraining sessions, and the exporter withheld three recent runs
as required by the privacy delay. The fixed loader and public export now
retain **934** eligible activities with **zero GPS route geometries**.
See [data-integrity reconciliation](data-integrity.md). A fully exhaustive
COROS-server reconciliation is not yet possible from archived data alone.
The separate private SQLite/FIT archive must not be rewritten, deleted, or
replaced by the reduced public export.

## Original execution checklist (completed where noted)

1. **Freeze publication.** Temporarily suspend the scheduled public-sync
   workflow and Vercel auto-deploys _when execution is authorized_, and
   coordinate with any collaborators. First verify the complete raw-data
   backup in the separate private repository. Preserve a local offline
   recovery backup that is never published.
2. **Inventory remote refs.** Fetch only the fork's own branches/tags and
   pull-request refs into a dedicated fresh clone. Check all exposed GitHub
   refs and the fork network; do not use `--mirror` to overwrite the upstream.
   Re-check fork count and PRs immediately before a rewrite. Inspect actual
   historical blobs and messages for sensitive locations or credentials,
   without printing them in CI logs or documentation.
3. **Prototype in an isolated clone.** _(Single-pass candidate validated;
   older two-pass candidate rejected; see results above.)_
   Evaluate `git-filter-repo` on the
   fork-specific commit range, leaving the upstream merge-base untouched.
   Candidate removals include FIT/GPX/TCX files, SQLite databases, import
   manifests, personalized generated SVGs, _historical_ raw activity JSON,
   and any encoded protected locations in tracked configuration. Preserve
   unrelated upstream changes. Restricting `--refs` produces a **partial**
   rewrite and requires checking every ref that may retain old commits; the
   first attempt must not target the live checkout.
4. **Restore the approved export.** _(Completed in first trial; repeat after
   every rewrite pass.)_ If filtering removes
   `src/static/activities.json` entirely, restore only the currently validated
   public export as a new commit in the isolated clone. Check that the
   resulting branch still builds, syncs, renders and merges reasonably with
   upstream. Inspect commit reachability (`git rev-list --objects`) and verify
   no fork-private GPS blob remains reachable from any branch/tag/PR ref.
   Evaluate preservation of the upstream merge-base explicitly. Remove any
   remaining inherited private files from the new `HEAD`, without rewriting
   the common ancestor. Compare all tracked paths and bytes against the
   approved tree, not only the allowlisted privacy paths.
5. **Review the migration plan.** Record changed commit counts, the first
   changed commit, affected refs, needed `--force-with-lease` targets, CI
   credentials, Vercel build configuration, and rollback procedure. Make
   an explicit decision about whether to retain the GitHub fork relationship.
   Leaving a fork network is permanent and may lose repository metadata; it
   is **not** a routine cleanup step.
6. **Completed after separate authorization:** coordinate a guarded push to the
   fork's `origin` (never `upstream`), verify the public refs, and prevent the
   older clones or sync workflow from reintroducing old objects. Resume sync
   only after the private archive and privacy-export guards pass.
7. **Purge other exposure surfaces.** _(Nine risky historical Vercel
   deployments deleted, three safe versions preserved on 2026-11-03.)_
   Check Cloudflare proxy caching and the
   `m.placeless.net` custom-domain mapping separately; the unrelated
   Cloudflare Pages applications are outside scope. Inspect GitHub Actions
   caches, stored artifacts, release
   assets, raw download URLs, and PR refs; request GitHub Support assistance
   for eligible sensitive-data cached views and unreachable objects. Old
   clones, forks and downloaded copies cannot be recalled by Git rewriting.
   Treat `placeless.net/running/` as a separate audit, not a deployment target.

## Batch 4 current-index cleanup (2026-11-03)

Two historical `PNG_OUT/share_image_*.png` files (generated by the old
`run_page/auto_share_sync.py` path) were removed **from the current Git
index only** and added to the generated-assets denylist. The physical files
were deliberately preserved locally, and no byte-level content review was
performed. This is a precaution against sharing personal activity graphics,
not evidence that those particular images contained precise GPS locations.
The deprecated Docker pipeline, which embedded data sync and generated
personal SVGs during image builds, and the optional GitHub Pages publisher
were also removed. The prior PNG commits, third-party caches and deployment
artifacts **remain separate exposure surfaces**. No history rewriting or
force push was performed in this refactor batch.

## Post-migration guardrails

Do **not** restore or merge the obsolete Fork history, attach private GPS
archive paths to a public commit, publish the local backup bundle, detach
the Fork, modify the independent Cloudflare Running application, or delete
the remaining safe Vercel deployments as part of routine maintenance.
Preserve the shared upstream merge-base for future clean upstream merges.
Revalidate public data on every export and handle GitHub cached-object
purging separately with GitHub Support.

References:

- [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [git-filter-repo: sensitive-data removal and `--refs`](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt)
- [GitHub: Detaching a fork](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork)
- [Vercel: Managing Deployments](https://vercel.com/docs/deployments/managing-deployments)
- [Vercel: Deployment Protection](https://vercel.com/docs/deployment-protection)

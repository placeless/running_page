# Deployment boundaries: placeless running apps

This is a fork-specific operational note, not a generic deployment instruction
for upstream `running_page` users.

| Public entry | Application | Maintenance scope |
| --- | --- | --- |
| `https://m.placeless.net/` | `running_page` dashboard, `placeless/running_page` | This repository |
| `https://placeless.net/running/` | `Running, over time` experiment | Separate application; outside this repository |

Both entry points returned HTTP 200 with distinct page titles on 2026-11-02.
Account-level Cloudflare routing was verified on 2026-11-03. These URLs do
not inherently conflict: one uses a subdomain, the other a path on the apex
domain.

## Verified live routing (November 2026)

| Entry or resource | Verified owner / origin | Evidence |
| --- | --- | --- |
| `m.placeless.net` | Vercel-hosted `running_page`, behind Cloudflare's HTTP proxy | Public response headers `x-vercel-id` and `x-vercel-cache`; GitHub deployment records created by `vercel[bot]` |
| `placeless.net` | Cloudflare Pages project `placeless-github-io` | Pages project source `placeless/placeless.github.io`; custom domain `placeless.net` |
| `placeless.net/running*` | Separate Cloudflare Worker route `placeless-running` | Zone Worker Routes API |
| `placeless-running.pages.dev` | Separate Cloudflare Pages project `placeless-running` | Pages project source `placeless/running`, branch `main` |

These are independent deployment boundaries. Cloudflare's DNS Records API
returned HTTP 403 for the current Wrangler OAuth identity, so the precise
`m.placeless.net` DNS record type and target are **not verified**. The HTTP
and GitHub deployment evidence independently identifies Vercel as the
running_page origin.

## Deployment and data ownership

- `running_page` is built with Vite (`pnpm build`, output `dist/`), with a
  root-relative default base path. Its current production frontend is hosted
  on **Vercel**, with Cloudflare in front. Review Vercel project settings,
  environment variables, build triggers, deployment protection, and old
  immutable deployments before any migration.
- The public `src/static/activities.json` is generated from the private
  `placeless/running-data-private` archive through the privacy exporter. The
  archive, its deploy key, and zone policy must stay outside public builds.
- The Cloudflare Worker route `placeless.net/running*` belongs to the
  **other** application. This repository has no Wrangler/Worker route or D1
  binding asserting ownership of that path; do not create one.
- The other application's JSON, routes and possible historical publications
  require **their own** privacy review. They are not covered by this
  repository's exporter and must never be silently rewritten by it.

## Before changing deployment or GitHub configuration

1. The Vercel project is `placeless-projects/running-page`. On 2026-11-03,
   account-level inventory initially found 12 Production deployments.
   Following explicit approval, nine versions associated with historical
   GPS routes were deleted and the three safe versions were preserved.
   The follow-up inventory confirmed **three remaining deployments**, and
   `m.placeless.net` continued to respond with HTTP 200. GitHub's **549**
   deployment records are not retained Vercel builds. See
   [history remediation](history-remediation.md) for the audit evidence.
2. In Cloudflare, preserve the verified Pages/Worker ownership above.
   Optionally verify the `m.placeless.net` DNS record using a DNS Read
   credential or dashboard; do not change the experiment's resources.
3. Verify that `m.placeless.net` continues to serve this dashboard after a
   repository update; verify `placeless.net/running/` independently as a
   regression check.
4. For historical private GPS removal, follow
   [history remediation](history-remediation.md). Vercel deployments, GitHub
   Git history, and Cloudflare proxy caches are distinct exposure surfaces.
   Changing a hostname or publishing a fresh build does not erase previous
   artifacts.

Do not interpret the generic README's Cloudflare example, GitHub Pages
workflow, or upstream documentation as the actual production routing contract.

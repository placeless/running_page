# Contributing

Thanks for contributing to this maintained Running Page fork. Start with [README.md](README.md) for architecture and [AGENTS.md](AGENTS.md) for safe repository operations. [README-CN.md](README-CN.md) covers local usage in Chinese.

## Local development

Use Node.js 20.19+, 22.13+, or 24+, plus pnpm. The frontend and its tests never need credentials:

```sh
pnpm install --frozen-lockfile
pnpm dev:sample                       # 12 invented, privacy-safe workouts
pnpm run check                        # non-mutating formatting check
pnpm run lint                         # non-mutating ESLint
node --test scripts/*.test.mjs        # synthetic/offline tests
pnpm run build                        # enforces the public data guard
node scripts/performance/check-bundles.mjs
```

Run `pnpm dev` to view the already-validated public snapshot instead. To run Python regression tests, use Python 3.12+ and install `requirements-dev.txt` in a virtual environment, then run `python -m pytest -q`. Python tests operate on synthetic fixtures; **never run provider downloads during CI or a PR check**.

## Code expectations

- Make one coherent change per batch and keep dependencies directed toward `src/core/`, not from core into components or themes.
- Prefer observable behavioral tests, including calendar boundaries, privacy filters and route segments. Do not assert implementation trivia unless it protects a meaningful public contract.
- Audit the import graph before moving or deleting a module. The `dashboard` and `classic` themes are both supported. Use shared data and computation rather than duplicate caches or geometry utilities.
- Avoid new packages for behavior that small, well-tested project code can cover. Measure performance before adding abstractions or optimization paths.
- Treat README, issue descriptions and old comments as potentially stale: correct docs when behavior changes.

## Privacy, credentials and publication

- **Never commit:** GPS source files, raw FIT/GPX/TCX, SQLite, import manifests, private policies or zones, personal images, auth tokens, cookies or actual location test data.
- Use `data/samples/activities.sample.json` and synthetic route tests. The public-data schema check is intentionally strict; **do not disable the Vite privacy guard**.
- COROS synchronization, private archive operations, history rewriting, GitHub workflows and production deploys have separate privileges. A source-code PR must not trigger an unsolicited sync against a private account.
- Fork-specific automated sync is currently COROS only; other provider scripts are legacy upstream integrations, not maintained CI paths.
- Do not push to upstream or change the `placeless.net/running/` app. A deployment change requires separate explicit approval.

## Pull request checklist

Explain what observable behavior or boundary changes, link to supporting code paths, list the tests run, and identify remaining evidence gaps. Before a PR, ensure `git diff --check`, `pnpm run check`, `pnpm run lint`, Node tests, Python tests as applicable, and `pnpm run build` pass. Include a privacy review when data schema, generated assets, sync or deployment is touched.

For specialized operations see [docs/fork-maintenance.md](docs/fork-maintenance.md), [docs/privacy-export.md](docs/privacy-export.md), and [docs/performance.md](docs/performance.md). Historical upstream documentation remains at [yihong0618/running_page](https://github.com/yihong0618/running_page).

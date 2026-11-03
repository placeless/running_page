import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('unsafe JSON blocks production builds even with legacy bypass variable', async () => {
  const config = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path.join(root, 'vite.config.ts')
  );
  const guard = config.config.plugins.find(
    (plugin) => plugin.name === 'public-activity-privacy-guard'
  );
  assert.ok(guard?.buildStart);

  // The normal build guard reads relative paths. Use an isolated Git index
  // and synthetic unsafe JSON rather than changing any real activity file.
  const fixture = mkdtempSync(path.join(tmpdir(), 'running-release-'));
  const cwd = process.cwd();
  const oldOverride = process.env.RUNNING_ALLOW_UNSAFE_LOCAL_PREVIEW;
  try {
    mkdirSync(path.join(fixture, 'assets'));
    mkdirSync(path.join(fixture, 'src/static'), { recursive: true });
    writeFileSync(
      path.join(fixture, 'src/static/activities.json'),
      JSON.stringify([
        { name: 'synthetic raw metadata', start_date: '2026-01-01' },
      ])
    );
    execFileSync('git', ['init', '-q'], { cwd: fixture });
    execFileSync('git', ['add', 'src/static/activities.json'], {
      cwd: fixture,
    });
    process.chdir(fixture);
    process.env.RUNNING_ALLOW_UNSAFE_LOCAL_PREVIEW = '1';
    assert.throws(() => guard.buildStart(), /unsafe|obsolete/i);

    writeFileSync(path.join(fixture, 'src/static/activities.json'), '[]');
    assert.doesNotThrow(() => guard.buildStart());
  } finally {
    process.chdir(cwd);
    if (oldOverride === undefined)
      delete process.env.RUNNING_ALLOW_UNSAFE_LOCAL_PREVIEW;
    else process.env.RUNNING_ALLOW_UNSAFE_LOCAL_PREVIEW = oldOverride;
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('sync jobs serialize and no workflow caches original activity data', () => {
  const sync = readFileSync(
    path.join(root, '.github/workflows/run_data_sync.yml'),
    'utf8'
  );
  const pages = readFileSync(
    path.join(root, '.github/workflows/gh-pages.yml'),
    'utf8'
  );
  assert.match(
    sync,
    /concurrency:\s*\n\s*group: running-data-sync-.*\n\s*cancel-in-progress: false/
  );
  assert.match(sync, /if: github\.ref == 'refs\/heads\/master'/);
  assert.doesNotMatch(sync, /actions\/cache@|SAVE_DATA_IN_GITHUB_CACHE/);
  assert.doesNotMatch(pages, /save_data_in_github_cache|data_cache_prefix/i);
  // Pages may cache the package-manager store, never private input files.
  const cacheSteps = pages
    .split(/\n {6}- /)
    .filter((step) => step.includes('actions/cache@'));
  for (const step of cacheSteps) {
    assert.doesNotMatch(
      step,
      /(?:FIT_OUT|GPX_OUT|TCX_OUT|Workouts|run_page\/data\.db|imported\.json|\n\s+(?:assets|activities)\s*$)/m
    );
  }
});

test('CI checks source without silently rewriting it', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(pkg.scripts.lint, /--fix/);
  assert.doesNotMatch(pkg.scripts.ci, /\bformat\b/);
  assert.match(pkg.scripts.ci, /\bcheck\b/);
  assert.match(pkg.scripts['lint:fix'], /--fix/);
});

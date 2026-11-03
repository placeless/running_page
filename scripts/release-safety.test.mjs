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
import {
  checkPublicRepository,
  privatePaths,
} from './check-public-repository.mjs';

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
    writeFileSync(
      path.join(fixture, 'src/static/races.json'),
      JSON.stringify({ version: 1, races: [] })
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
    writeFileSync(
      path.join(fixture, 'src/static/races.json'),
      JSON.stringify({ version: 2, races: [] })
    );
    assert.throws(() => guard.buildStart(), /race approval/i);
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
  assert.match(
    sync,
    /concurrency:\s*\n\s*group: running-data-sync-.*\n\s*cancel-in-progress: false/
  );
  assert.match(sync, /if: github\.ref == 'refs\/heads\/master'/);
  assert.doesNotMatch(sync, /actions\/cache@|SAVE_DATA_IN_GITHUB_CACHE/);
  assert.doesNotMatch(sync, /BUILD_GH_PAGES|SAVE_TO_PARQENT|RUN_TYPE:/);
  assert.match(sync, /python run_page\/coros_sync\.py/);
  assert.doesNotMatch(
    sync,
    /python run_page\/(?:strava|nike|keep|garmin)_sync\.py/
  );
  assert.match(sync, /git add -- src\/static\/activities\.json/);
  assert.doesNotMatch(sync, /git add \.(?:\n|$)/);
  const orderedSteps = [
    'Require private archive before downloading raw GPS',
    'Checkout private GPS archive',
    'Restore private GPS data',
    'Prepare private publication policy',
    'Download COROS updates and generate privacy-filtered JSON',
    'Verify public privacy export',
    'Reconcile COROS inventory with public totals',
    'Back up original GPS data to private archive',
    'Commit only sanitized public activity JSON',
  ];
  let previous = -1;
  for (const label of orderedSteps) {
    const position = sync.indexOf('- name: ' + label);
    assert.ok(position > previous, 'Missing or reordered sync step: ' + label);
    previous = position;
  }
  assert.match(sync, /git -C \.private-running-data push/);
});

test('public index rejects generated image and raw-workout directories', () => {
  for (const filename of [
    'PNG_OUT/share_image_2026-01-01.png',
    'Workouts/session.fit',
    'src/run_page',
    'private/privacy.json',
    'run_page/data.db',
  ]) {
    assert.ok(
      privatePaths.some((pattern) => pattern.test(filename)),
      filename
    );
  }
  const fixture = mkdtempSync(path.join(tmpdir(), 'running-private-index-'));
  const oldCwd = process.cwd();
  try {
    mkdirSync(path.join(fixture, 'assets'));
    mkdirSync(path.join(fixture, 'PNG_OUT'));
    writeFileSync(
      path.join(fixture, 'PNG_OUT', 'synthetic.png'),
      'not a real image'
    );
    execFileSync('git', ['init', '-q'], { cwd: fixture });
    execFileSync('git', ['add', 'PNG_OUT/synthetic.png'], { cwd: fixture });
    process.chdir(fixture);
    assert.throws(() => checkPublicRepository(), /private files/);
  } finally {
    process.chdir(oldCwd);
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('CI checks source without silently rewriting it', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(pkg.scripts.lint, /--fix/);
  assert.doesNotMatch(pkg.scripts.ci, /\bformat\b/);
  assert.match(pkg.scripts.ci, /\bcheck\b/);
  assert.match(pkg.scripts['lint:fix'], /--fix/);
});

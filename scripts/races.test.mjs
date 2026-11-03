import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTypeScriptLoader } from './test-utils/load-typescript.mjs';
import { validateCuratedRaces } from './validate-curated-races.mjs';

const actualCatalog = JSON.parse(readFileSync('src/static/races.json', 'utf8'));
const sampleRace = {
  activity: {
    date: '2026-03-15',
    distance_m: 4320,
    moving_time: '0:19:30',
  },
  name: 'Example Approved 5K Race',
  race_distance_m: 5000,
  official_time_seconds: null,
};
const activity = (options = {}) => ({
  run_id: 12,
  type: 'Run',
  start_date_local: '2026-03-15',
  distance: 4320,
  moving_time: '0:19:30',
  ...options,
});

function withFixture(races, activities, callback) {
  const dir = mkdtempSync(path.join(tmpdir(), 'running-race-'));
  const raceFile = path.join(dir, 'races.json');
  const activityFile = path.join(dir, 'activities.json');
  try {
    writeFileSync(raceFile, JSON.stringify({ version: 1, races }));
    writeFileSync(activityFile, JSON.stringify(activities));
    return callback(raceFile, activityFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('only explicitly approved public races may be published', () => {
  assert.equal(validateCuratedRaces(), 1);
  assert.equal(
    withFixture([sampleRace], [activity()], validateCuratedRaces),
    1
  );
});

test('approval selection cannot be fooled by private run IDs or nearby activities', () => {
  const { resolveApprovedRaces } = createTypeScriptLoader()(
    'src/core/domain/races'
  );
  const catalog = { version: 1, races: [sampleRace] };
  const adjacent = [
    activity({ run_id: 222, moving_time: '0:20:30' }),
    activity({ run_id: 333 }),
  ];
  assert.equal(resolveApprovedRaces(adjacent, catalog)[0].activity.run_id, 333);
  assert.deepEqual(resolveApprovedRaces(adjacent.slice(0, 1), catalog), []);
  assert.deepEqual(
    resolveApprovedRaces([activity(), activity({ run_id: 44 })], catalog),
    []
  );
  assert.throws(
    () =>
      withFixture(
        [sampleRace],
        [activity(), activity({ run_id: 44 })],
        validateCuratedRaces
      ),
    /exactly one/
  );
});

test('unmatched selectors, duplicate approvals, unsafe text and extra provider metadata fail closed', () => {
  assert.throws(
    () => withFixture([sampleRace], [], validateCuratedRaces),
    /exactly one/
  );
  assert.throws(
    () =>
      withFixture([sampleRace, sampleRace], [activity()], validateCuratedRaces),
    /Duplicate/
  );
  assert.throws(
    () =>
      withFixture(
        [
          sampleRace,
          {
            ...sampleRace,
            activity: { ...sampleRace.activity, distance_m: 4320.02 },
          },
        ],
        [activity()],
        validateCuratedRaces
      ),
    /same public run/
  );
  for (const edit of [
    { name: '<script>unsafe</script>' },
    { provider_id: 987 },
    { activity: { ...sampleRace.activity, gps: [42.9, -5.9] } },
    { official_time_seconds: -5 },
    { official_time_seconds: '19:30' },
    { race_distance_m: Infinity },
    { activity: { ...sampleRace.activity, moving_time: '0:70:99' } },
  ]) {
    assert.throws(
      () =>
        withFixture(
          [{ ...sampleRace, ...edit }],
          [activity()],
          validateCuratedRaces
        ),
      /Invalid|unsafe/
    );
  }
});

test('official time is optional, separate from device moving time', () => {
  const { RaceRecords } = createTypeScriptLoader({
    '../hooks/useLocale': { useLocale: () => ({ locale: 'en' }) },
    '../static/races.json': { version: 1, races: [sampleRace] },
  })('src/components/RaceRecords.tsx');
  const html = renderToStaticMarkup(
    createElement(RaceRecords, {
      activities: [activity()],
      onSelectActivity: () => {},
    })
  );
  assert.match(html, /Example Approved 5K Race/);
  assert.match(html, /Official time/);
  assert.match(html, /Not supplied/);
  assert.match(html, /Recorded GPS/);
  assert.match(html, /4\.32 km/);
  assert.match(html, /19:30/);
  assert.match(html, /<button/);
  assert.doesNotMatch(html, /00:19:30/);
  assert.equal(
    renderToStaticMarkup(
      createElement(RaceRecords, {
        activities: [activity({ distance: 6000 })],
      })
    ),
    ''
  );
  const official = { ...sampleRace, official_time_seconds: 1300 };
  const { RaceRecords: WithOfficialTime } = createTypeScriptLoader({
    '../hooks/useLocale': { useLocale: () => ({ locale: 'en' }) },
    '../static/races.json': { version: 1, races: [official] },
  })('src/components/RaceRecords.tsx');
  const officialHtml = renderToStaticMarkup(
    createElement(WithOfficialTime, { activities: [activity()] })
  );
  assert.match(officialHtml, /21:40/);
  assert.match(officialHtml, /19:30/);
  assert.doesNotMatch(officialHtml, /Not supplied/);
});

test('approved metadata is a separate publication; source activity title stays generic', () => {
  const publicRows = JSON.parse(
    readFileSync('src/static/activities.json', 'utf8')
  );
  const selector = actualCatalog.races[0].activity;
  const matched = publicRows.filter(
    (a) =>
      a.start_date_local === selector.date &&
      a.distance === selector.distance_m &&
      a.moving_time === selector.moving_time
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].name, 'Run');
  assert.equal(actualCatalog.races[0].official_time_seconds, null);
  const { RaceRecords } = createTypeScriptLoader({
    '../hooks/useLocale': { useLocale: () => ({ locale: 'en' }) },
    '../static/races.json': actualCatalog,
  })('src/components/RaceRecords.tsx');
  const actual = renderToStaticMarkup(
    createElement(RaceRecords, { activities: publicRows })
  );
  assert.match(actual, /Rotary Club de Oviedo/);
  assert.match(actual, /4\.33 km/);
  assert.match(actual, /16:19/);
  assert.match(actual, /Not supplied/);
  const { RaceRecords: ChineseRaceRecords } = createTypeScriptLoader({
    '../hooks/useLocale': { useLocale: () => ({ locale: 'zh' }) },
    '../static/races.json': actualCatalog,
  })('src/components/RaceRecords.tsx');
  const translated = renderToStaticMarkup(
    createElement(ChineseRaceRecords, { activities: publicRows })
  );
  assert.match(translated, /赛事记录/);
  assert.match(translated, /官方成绩/);
  assert.match(translated, /未提供/);
});

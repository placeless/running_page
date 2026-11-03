import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTypeScriptLoader } from './test-utils/load-typescript.mjs';

const loadSource = createTypeScriptLoader();
const calendar = loadSource('src/core/domain/calendar');
const metrics = loadSource('src/core/domain/metrics');
const periods = loadSource('src/core/domain/periods');
const bests = loadSource('src/core/domain/bests');
const summary = loadSource('src/utils/summary');

function activity(
  day,
  type = 'Run',
  distance = 10000,
  moving_time = '00:50:00',
  extra = {}
) {
  return {
    start_date_local: day,
    type,
    distance,
    moving_time,
    average_heartrate: null,
    elevation_gain: 0,
    subtype: null,
    ...extra,
  };
}

test('provider-local date arithmetic is stable at Madrid DST and year boundaries', () => {
  assert.equal(calendar.addCalendarDays('2026-03-28', 1), '2026-03-29');
  assert.equal(calendar.addCalendarDays('2026-03-29', 1), '2026-03-30');
  assert.equal(calendar.addCalendarDays('2026-10-25', 1), '2026-10-26');
  assert.equal(calendar.addCalendarDays('2026-01-01', -1), '2025-12-31');
  assert.equal(calendar.mondayOf('2026-01-01'), '2025-12-29');
  assert.equal(calendar.previousMonthCutoff('2026-03-31'), '2026-02-28');
  assert.equal(calendar.previousMonthCutoff('2024-03-31'), '2024-02-29');
  assert.equal(calendar.previousYearCutoff('2024-02-29'), '2023-02-28');
  assert.equal(calendar.isoWeekKey('2021-01-01'), '2020-W53');
  assert.equal(calendar.isoWeekKey('2026-01-01'), '2026-W01');
});

test('current/longest streaks count calendar days and ISO weeks, not 24-hour gaps', () => {
  const dates = [
    activity('2026-03-28'),
    activity('2026-03-29'),
    activity('2026-03-29', 'WeightTraining', 0),
    activity('2026-03-30'),
  ];
  assert.deepEqual(calendar.activityStreaks(dates, '2026-03-30'), {
    currentDays: 3,
    longestDays: 3,
    currentWeeks: 2,
    longestWeeks: 2,
  });
  const yearCrossing = [
    activity('2020-12-31'),
    activity('2021-01-01'),
    activity('2021-01-04'),
  ];
  assert.equal(
    calendar.activityStreaks(yearCrossing, '2021-01-05').currentWeeks,
    2
  );
  assert.equal(calendar.activityStreaks(dates, '2026-04-20').currentDays, 0);
});

test('historical year comparison uses complete years, not today YTD', () => {
  const entries = [
    activity('2024-12-10', 'Run', 10000),
    activity('2025-12-10', 'Run', 10000),
  ];
  const data = periods.dashboardPeriods(
    entries.filter((a) => a.start_date_local.startsWith('2025')),
    entries,
    2025,
    'all',
    '2026-11-03'
  );
  assert.equal(data.thisYear.distance, 10000);
  assert.equal(data.lastYear.distance, 10000);
});

test('current YTD excludes future dates and matches prior year calendar cutoff', () => {
  const entries = [
    activity('2026-11-02', 'Run', 6000),
    activity('2026-11-05', 'Run', 9000),
    activity('2025-11-02', 'Run', 5000),
    activity('2025-11-04', 'Run', 8000),
  ];
  const data = periods.dashboardPeriods(
    entries,
    entries,
    null,
    'all',
    '2026-11-03'
  );
  assert.equal(data.thisYear.distance, 6000);
  assert.equal(data.lastYear.distance, 5000);
  assert.equal(data.thisMonth.count, 1);
});

test('month and ISO week same-period comparisons clamp dates and honor Monday', () => {
  const today = '2026-03-31';
  const entries = [
    activity('2026-03-31', 'Run', 1000),
    activity('2026-02-28', 'Run', 2000),
    activity('2026-02-27', 'Run', 3000),
    activity('2026-03-30', 'Run', 4000),
    activity('2026-03-23', 'Run', 5000),
    activity('2026-03-24', 'Run', 6000),
    activity('2026-03-25', 'Run', 7000),
  ];
  const data = periods.dashboardPeriods(entries, entries, null, 'all', today);
  assert.equal(data.lastMonth.distance, 5000);
  assert.equal(data.thisWeek.distance, 5000);
  assert.equal(data.lastWeek.distance, 11000);
});

test('moving time handles legacy duration formats without treating them as dates', () => {
  assert.equal(metrics.parseMovingTime('1 day, 01:02:03'), 90123);
  assert.equal(metrics.parseMovingTime('1970-01-02 10:44:26.134000'), 125066);
  assert.equal(metrics.parseMovingTime('1:20:00'), 4800);
  assert.equal(metrics.parseMovingTime(3600), 3600);
  assert.equal(metrics.parseMovingTime(-1), 0);
  assert.equal(metrics.parseMovingTime('bad'), 0);
});

test('running pace is distance/time weighted; strength time never slows it down', () => {
  const entries = [
    activity('2026-11-01', 'Run', 1000, '00:03:00'),
    activity('2026-11-02', 'Run', 10000, '01:00:00'),
    activity('2026-11-03', 'WeightTraining', 0, '00:30:00'),
  ];
  assert.equal(metrics.sumMovement(entries).seconds, 5580);
  assert.equal(metrics.runningMovement(entries).speed, 11000 / 3780);
  assert.equal(
    metrics.runningMovement([
      ...entries,
      activity('2026-11-04', 'Run', 0, '01:00:00'),
    ]).speed,
    11000 / 3780
  );
  assert.equal(metrics.summarizeActivities(entries).speed, 0);
  assert.equal(
    metrics.summarizeActivities(entries.slice(0, 2)).speed,
    11000 / 3780
  );
  assert.equal(metrics.summarizeActivities(entries).count, 3);
});

test('mean heart rate weights activity HR by recorded moving duration', () => {
  const entries = [
    activity('2026-11-01', 'Run', 1000, '00:03:00', { average_heartrate: 180 }),
    activity('2026-11-02', 'Run', 10000, '01:00:00', {
      average_heartrate: 120,
    }),
  ];
  assert.equal(
    metrics.summarizeActivities(entries).heartRate,
    (180 * 180 + 120 * 3600) / 3780
  );
});

test('Summary day breakdown uses sport and moving minutes, not invented hours', () => {
  const items = [
    activity('2026-11-01', 'Run', 5000, '00:25:00'),
    activity('2026-11-01', 'WeightTraining', 0, '00:30:00'),
  ];
  assert.deepEqual(summary.summaryChart(items, 'day', '2026-11-01'), [
    { label: 'Run', value: 25 },
    { label: 'WeightTraining', value: 30 },
  ]);
  assert.equal(summary.summaryKey('2021-01-01', 'week'), '2020-W53');
});

test('matched full activities do not misrepresent 4.8 or 10.8 km as exact PRs', () => {
  const entries = [
    activity('2026-11-01', 'Run', 4800, '00:18:00'),
    activity('2026-11-02', 'Run', 5020, '00:28:00'),
    activity('2026-11-03', 'Run', 10800, '00:40:00'),
    activity('2026-11-04', 'Run', 10030, '00:55:00', { subtype: 'indoor' }),
    activity('2026-11-05', 'Run', 10060, '01:03:00'),
  ];
  const matched = bests.matchedFullRuns(entries);
  assert.equal(matched[0].activity.distance, 5020);
  assert.equal(matched[1].activity.distance, 10060);
  assert.equal(matched[2].activity, null);
  assert.equal(matched[3].activity, null);
});

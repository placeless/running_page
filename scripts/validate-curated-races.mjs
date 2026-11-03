import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const fields = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  Object.keys(value).every((key) => names.includes(key));

const validDate = (day) => {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const value = new Date(day + 'T12:00:00Z');
  return (
    !Number.isNaN(value.valueOf()) && value.toISOString().slice(0, 10) === day
  );
};

/**
 * Validate a hand-curated public catalog, never a private title collection.
 * Exact field sets prevent accidental leakage of provider IDs, addresses,
 * source titles, raw timestamps, coordinates, or unrelated personal metadata.
 */
export function validateCuratedRaces(
  catalogPath = 'src/static/races.json',
  activityPath = 'src/static/activities.json'
) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const activities = JSON.parse(readFileSync(activityPath, 'utf8'));
  if (
    !fields(catalog, ['version', 'races']) ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.races) ||
    !Array.isArray(activities)
  )
    throw new Error('Invalid public race approval catalog');

  const selectors = new Set();
  const approvedActivities = new Set();
  for (const race of catalog.races) {
    if (
      !fields(race, [
        'activity',
        'name',
        'race_distance_m',
        'official_time_seconds',
      ]) ||
      !fields(race.activity, ['date', 'distance_m', 'moving_time']) ||
      !validDate(race.activity.date) ||
      typeof race.activity.distance_m !== 'number' ||
      !Number.isFinite(race.activity.distance_m) ||
      race.activity.distance_m <= 0 ||
      typeof race.activity.moving_time !== 'string' ||
      !/^\d{1,3}:[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(race.activity.moving_time) ||
      typeof race.name !== 'string' ||
      !race.name.trim() ||
      race.name.length > 100 ||
      /[<>\u0000-\u001f\u007f]/.test(race.name) ||
      typeof race.race_distance_m !== 'number' ||
      !Number.isFinite(race.race_distance_m) ||
      race.race_distance_m < 500 ||
      race.race_distance_m > 500000 ||
      (race.official_time_seconds !== null &&
        (!Number.isInteger(race.official_time_seconds) ||
          race.official_time_seconds <= 0 ||
          race.official_time_seconds > 864000))
    )
      throw new Error('Invalid or unsafe race approval');
    const selector = [
      race.activity.date,
      race.activity.distance_m,
      race.activity.moving_time,
    ].join('|');
    if (selectors.has(selector))
      throw new Error('Duplicate race approval selector');
    selectors.add(selector);
    const matching = activities.filter(
      (activity) =>
        activity.type === 'Run' &&
        activity.start_date_local === race.activity.date &&
        Math.abs(activity.distance - race.activity.distance_m) <= 0.05 &&
        activity.moving_time === race.activity.moving_time
    );
    if (matching.length !== 1)
      throw new Error('Race approval must match exactly one public run');
    if (approvedActivities.has(matching[0]))
      throw new Error('Multiple race approvals refer to the same public run');
    approvedActivities.add(matching[0]);
  }
  return catalog.races.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    'Validated ' +
      validateCuratedRaces(process.argv[2], process.argv[3]) +
      ' manually approved races'
  );
}

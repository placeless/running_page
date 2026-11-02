// Cloudflare and CI have no access to the private zone policy. The Python
// exporter verifies zone geometry; this check rejects legacy/raw output before
// packaging it into a public frontend build.
import { readFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';

export function validatePublicData(path = 'src/static/activities.json') {
  const records = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(records)) {
    throw Error('Public activity export must be an array');
  }
  for (const record of records) {
    if (
      !record ||
      typeof record !== 'object' ||
      typeof record.start_date_local !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.start_date_local) ||
      record.start_date !== record.start_date_local ||
      record.name !== (record.type || 'Activity') ||
      record.location_country !== null ||
      !Array.isArray(record.route_segments) ||
      (record.summary_polyline !== null &&
        !record.route_segments.includes(record.summary_polyline)) ||
      Object.keys(record).length !== PUBLIC_FIELDS.size ||
      Object.keys(record).some((key) => !PUBLIC_FIELDS.has(key))
    ) {
      throw Error(
        'Unsafe or obsolete public activity export. Run the Python privacy exporter before deployment.'
      );
    }
  }
  return records.length;
}

const PUBLIC_FIELDS = new Set([
  'run_id',
  'name',
  'distance',
  'moving_time',
  'type',
  'subtype',
  'start_date',
  'start_date_local',
  'location_country',
  'country_code',
  'region',
  'summary_polyline',
  'route_segments',
  'average_heartrate',
  'average_speed',
  'elevation_gain',
  'streak',
]);

if (process.argv[1]?.endsWith('validate-public-data.mjs')) {
  console.log(
    `Validated ${validatePublicData(process.argv[2])} public activities`
  );
}

import type { Activity } from '../types';
import { parseMovingTime } from './metrics';

/** Entire recorded activities, NOT certified race PBs or exact-distance splits. */
const DISTANCES = [
  { key: '5K', meters: 5000, maxMeters: 5500 },
  { key: '10K', meters: 10000, maxMeters: 11000 },
  { key: 'Half Marathon', meters: 21097.5, maxMeters: 22500 },
  { key: 'Marathon', meters: 42195, maxMeters: 44000 },
] as const;

// Recorded race routes routinely exceed the official course distance.
// A symmetric ±1% band incorrectly discarded faster 10.2 km and 21.3 km
// activities. Permit a small GPS undershoot, but keep the upper bound
// explicit so very long training runs do not count as standard distances.
const GPS_UNDERSHOOT_TOLERANCE = 0.01;
const MIN_PACE_SECONDS_PER_KM = 180;
const MAX_PACE_SECONDS_PER_KM = 480;

export function matchedFullRuns(activities: readonly Activity[]) {
  const eligible = activities.filter(
    (a) =>
      a.type === 'Run' &&
      a.distance > 0 &&
      parseMovingTime(a.moving_time) > 0 &&
      !/treadmill|indoor/i.test(a.subtype ?? '')
  );
  return DISTANCES.map(({ key, meters, maxMeters }) => {
    const candidates = eligible.filter((a) => {
      if (
        a.distance < meters * (1 - GPS_UNDERSHOOT_TOLERANCE) ||
        a.distance > maxMeters
      )
        return false;
      const seconds = parseMovingTime(a.moving_time);
      const paceSecondsPerKm = (seconds * 1000) / a.distance;
      return (
        paceSecondsPerKm >= MIN_PACE_SECONDS_PER_KM &&
        paceSecondsPerKm <= MAX_PACE_SECONDS_PER_KM
      );
    });
    const activity = candidates.reduce<Activity | null>(
      (best, a) =>
        best === null ||
        parseMovingTime(a.moving_time) < parseMovingTime(best.moving_time)
          ? a
          : best,
      null
    );
    return {
      key,
      activity,
      seconds: activity ? parseMovingTime(activity.moving_time) : 0,
    };
  });
}

import type { Activity } from '../types';
import { parseMovingTime } from './metrics';

/** Activity-level comparisons, NOT certified race PBs or exact-distance splits. */
const DISTANCES = [
  { key: '5K', meters: 5000 },
  { key: '10K', meters: 10000 },
  { key: 'Half Marathon', meters: 21097.5 },
  { key: 'Marathon', meters: 42195 },
] as const;

/** Allow normal GPS variance, but never match a substantially different run. */
const DISTANCE_TOLERANCE = 0.01;

export function matchedFullRuns(activities: readonly Activity[]) {
  const eligible = activities.filter(
    (a) =>
      a.type === 'Run' &&
      a.distance > 0 &&
      parseMovingTime(a.moving_time) > 0 &&
      !/treadmill|indoor/i.test(a.subtype ?? '')
  );
  return DISTANCES.map(({ key, meters }) => {
    const candidates = eligible.filter(
      (a) => Math.abs(a.distance - meters) / meters <= DISTANCE_TOLERANCE
    );
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

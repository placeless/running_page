import type { Activity } from '../types';

/**
 * Explicitly reviewed, public race metadata. Not a provider activity title:
 * titles in the private database may contain sensitive home/work locations.
 *
 * The selector uses already-public data rather than private provider IDs or
 * unstable sequential run_id values. Ambiguous or stale selectors fail closed.
 */
export interface ApprovedRace {
  activity: {
    date: string;
    distance_m: number;
    moving_time: string;
  };
  name: string;
  race_distance_m: number;
  /** Verified official race time only. Null means no official result supplied. */
  official_time_seconds: number | null;
}

export interface ApprovedRaceCatalog {
  version: 1;
  races: ApprovedRace[];
}

export function resolveApprovedRaces(
  activities: readonly Activity[],
  catalog: ApprovedRaceCatalog
): { race: ApprovedRace; activity: Activity }[] {
  return catalog.races.flatMap((race) => {
    const matches = activities.filter(
      (activity) =>
        activity.type === 'Run' &&
        activity.start_date_local === race.activity.date &&
        Math.abs(activity.distance - race.activity.distance_m) <= 0.05 &&
        activity.moving_time === race.activity.moving_time
    );
    // Never guess which of two similar runs was the actual race.
    return matches.length === 1 ? [{ race, activity: matches[0] }] : [];
  });
}

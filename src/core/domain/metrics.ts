import type { Activity } from '../types';

/** Moving time is a duration, never a timestamp; source formats are historical. */
export function parseMovingTime(
  time: string | number | undefined | null
): number {
  if (time == null || time === '') return 0;
  if (typeof time === 'number')
    return Number.isFinite(time) && time >= 0 ? time : 0;
  let value = time.trim();
  let extra = 0;
  const days = value.match(/^(\d+)\s+days?,\s*/);
  if (days) {
    extra = Number(days[1]) * 86400;
    value = value.slice(days[0].length);
  }
  const epoch = value.match(/^1970-01-(\d{2})\s+/);
  if (epoch) {
    extra += (Number(epoch[1]) - 1) * 86400;
    value = value.slice(epoch[0].length);
  }
  if (!value) return 0;
  const parts = value.split('.')[0].split(':').map(Number);
  if (
    !parts.length ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part) || part < 0)
  )
    return 0;
  let clockSeconds = 0;
  for (const part of parts) clockSeconds = clockSeconds * 60 + part;
  return extra + clockSeconds;
}

export function sumMovement(activities: readonly Activity[]) {
  let distance = 0;
  let seconds = 0;
  for (const activity of activities) {
    distance += activity.distance;
    seconds += parseMovingTime(activity.moving_time);
  }
  return { distance, seconds, speed: seconds > 0 ? distance / seconds : 0 };
}

/** Running pace must not include the clock time of strength training. */
export function runningMovement(activities: readonly Activity[]) {
  return sumMovement(
    activities.filter(
      (activity) =>
        activity.type === 'Run' &&
        activity.distance > 0 &&
        parseMovingTime(activity.moving_time) > 0
    )
  );
}

export function summarizeActivities(activities: readonly Activity[]) {
  const { distance, seconds } = sumMovement(activities);
  const types = new Set(activities.map((activity) => activity.type));
  const isPaceSport =
    types.size === 1 &&
    ['Run', 'TrailRun', 'Walk', 'Hike'].includes(activities[0]?.type ?? '');
  const moving = activities.filter(
    (a) => a.distance > 0 && parseMovingTime(a.moving_time) > 0
  );
  const speed = isPaceSport ? sumMovement(moving).speed : 0;
  let fastest = 0;
  let elevation = 0;
  let weightedHeartRate = 0;
  let heartRateSeconds = 0;
  for (const activity of activities) {
    elevation += activity.elevation_gain ?? 0;
    if (isPaceSport && activity.distance > 0) {
      const movingTime = parseMovingTime(activity.moving_time);
      if (movingTime > 0)
        fastest = Math.max(fastest, activity.distance / movingTime);
    }
    const movingTime = parseMovingTime(activity.moving_time);
    if ((activity.average_heartrate ?? 0) > 0 && movingTime > 0) {
      weightedHeartRate += activity.average_heartrate! * movingTime;
      heartRateSeconds += movingTime;
    }
  }
  return {
    distance,
    seconds,
    count: activities.length,
    speed,
    maxDistance: activities.reduce((max, a) => Math.max(max, a.distance), 0),
    maxSpeed: fastest,
    elevation,
    heartRate: heartRateSeconds ? weightedHeartRate / heartRateSeconds : null,
  };
}

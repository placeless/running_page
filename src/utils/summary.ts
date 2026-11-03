import type { Activity } from '../types';
import { isoWeekKey } from '../core/domain/calendar';
import { parseMovingTime, summarizeActivities } from '../core/domain/metrics';

export type SummaryPeriod = 'year' | 'month' | 'week' | 'day' | 'life';

// Use the recorded local calendar date, independent of the viewer's timezone.
export function summaryKey(date: string, period: SummaryPeriod): string {
  if (period === 'life') return 'Life';
  if (period === 'year') return date.slice(0, 4);
  if (period === 'month') return date.slice(0, 7);
  if (period === 'day') return date.slice(0, 10);
  return isoWeekKey(date.slice(0, 10));
}

export function summarize(activities: Activity[]) {
  return summarizeActivities(activities);
}

export function groupSummary(activities: Activity[], period: SummaryPeriod) {
  const groups = new Map<string, Activity[]>();
  for (const activity of activities) {
    const key = summaryKey(activity.start_date_local, period);
    const group = groups.get(key) ?? [];
    group.push(activity);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export function summaryChart(
  activities: Activity[],
  period: SummaryPeriod,
  key: string
) {
  const buckets = new Map<string, number>();
  const bucketFor = (a: Activity) => {
    const date = a.start_date_local.slice(0, 10);
    if (period === 'life') return date.slice(0, 4);
    if (period === 'year') return date.slice(5, 7);
    if (period === 'month') return date.slice(8, 10);
    if (period === 'week')
      return String(((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1);
    // The public export deliberately strips exact start times. A daily
    // breakdown is by sport and duration, not invented hour-of-day buckets.
    return a.type;
  };
  let length = 0;
  if (period === 'year') length = 12;
  if (period === 'month')
    length = new Date(
      Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)
    ).getUTCDate();
  if (period === 'week') length = 7;
  for (let i = 1; i <= length; i++)
    buckets.set(period === 'week' ? String(i) : String(i).padStart(2, '0'), 0);
  for (const activity of activities) {
    const bucket = bucketFor(activity);
    const amount =
      period === 'day'
        ? parseMovingTime(activity.moving_time) / 60
        : activity.distance / 1000;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + amount);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value: Number(value.toFixed(2)) }));
}

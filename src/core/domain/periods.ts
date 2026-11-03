import type { Activity, SportFilter } from '../types';
import {
  activityDay,
  activityYear,
  addCalendarDays,
  mondayOf,
  previousMonthCutoff,
  previousYearCutoff,
} from './calendar';
import { sumMovement } from './metrics';

type PeriodTotals = { count: number; distance: number; seconds: number };

function totals(activities: readonly Activity[]): PeriodTotals {
  const { distance, seconds } = sumMovement(activities);
  return { count: activities.length, distance, seconds };
}

/**
 * Compare aligned calendar periods. A historical selected year is compared
 * whole-year to whole-year, not to the current day in the previous year.
 */
export function dashboardPeriods(
  activities: readonly Activity[],
  allActivities: readonly Activity[],
  year: number | null,
  filter: SportFilter,
  today: string
) {
  const currentYear = year ?? activityYear(today);
  const todayYear = activityYear(today);
  const scoped =
    filter === 'all'
      ? allActivities
      : allActivities.filter((activity) => activity.type === filter);
  const yearEnd = currentYear === todayYear ? today : `${currentYear}-12-31`;
  const previousEnd =
    currentYear === todayYear
      ? previousYearCutoff(today)
      : `${currentYear - 1}-12-31`;

  const thisYear = totals(
    activities.filter(
      (activity) =>
        activityYear(activity.start_date_local) === currentYear &&
        activityDay(activity.start_date_local) <= yearEnd
    )
  );
  const lastYear = totals(
    scoped.filter((activity) => {
      const day = activityDay(activity.start_date_local);
      return activityYear(day) === currentYear - 1 && day <= previousEnd;
    })
  );

  const previousMonthEnd = previousMonthCutoff(today);
  const thisMonth = totals(
    scoped.filter((a) => {
      const day = activityDay(a.start_date_local);
      return day.slice(0, 7) === today.slice(0, 7) && day <= today;
    })
  );
  const lastMonth = totals(
    scoped.filter((a) => {
      const day = activityDay(a.start_date_local);
      return (
        day.slice(0, 7) === previousMonthEnd.slice(0, 7) &&
        day <= previousMonthEnd
      );
    })
  );
  const monday = mondayOf(today);
  const lastMonday = addCalendarDays(monday, -7);
  const lastWeekEnd = addCalendarDays(today, -7);
  const thisWeek = totals(
    scoped.filter((a) => {
      const day = activityDay(a.start_date_local);
      return day >= monday && day <= today;
    })
  );
  const lastWeek = totals(
    scoped.filter((a) => {
      const day = activityDay(a.start_date_local);
      return day >= lastMonday && day <= lastWeekEnd;
    })
  );
  return {
    currentYear,
    thisYear,
    lastYear,
    thisMonth,
    lastMonth,
    thisWeek,
    lastWeek,
  };
}

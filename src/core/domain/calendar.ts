/** Calendar-day operations for provider-local dates, independent of viewer TZ/DST. */
export const activityDay = (localDate: string): string =>
  localDate.slice(0, 10);

export const activityYear = (localDate: string): number =>
  Number(localDate.slice(0, 4));

export function todayLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function atUTCNoon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function fromUTCDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(day: string, count: number): string {
  const date = atUTCNoon(day);
  date.setUTCDate(date.getUTCDate() + count);
  return fromUTCDate(date);
}

export function mondayOf(day: string): string {
  const weekday = (atUTCNoon(day).getUTCDay() + 6) % 7;
  return addCalendarDays(day, -weekday);
}

export function isoWeekKey(day: string): string {
  const thursday = addCalendarDays(
    day,
    3 - ((atUTCNoon(day).getUTCDay() + 6) % 7)
  );
  const weekYear = activityYear(thursday);
  const firstMonday = mondayOf(`${weekYear}-01-04`);
  const week =
    1 +
    Math.round(
      (atUTCNoon(mondayOf(day)).getTime() - atUTCNoon(firstMonday).getTime()) /
        (7 * 86400000)
    );
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function previousMonthCutoff(day: string): string {
  const date = atUTCNoon(day);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const comparable = Math.min(
    Number(day.slice(8, 10)),
    daysInMonth(year, month)
  );
  return `${year}-${String(month).padStart(2, '0')}-${String(comparable).padStart(2, '0')}`;
}

export function previousYearCutoff(day: string): string {
  const year = activityYear(day) - 1;
  const month = Number(day.slice(5, 7));
  const comparable = Math.min(
    Number(day.slice(8, 10)),
    daysInMonth(year, month)
  );
  return `${year}-${String(month).padStart(2, '0')}-${String(comparable).padStart(2, '0')}`;
}

type DatedActivity = { start_date_local: string };

function consecutiveLength(dates: Set<string>, newest: string, step: number) {
  let count = 0;
  for (let day = newest; dates.has(day); day = addCalendarDays(day, -step))
    count++;
  return count;
}

function longestStreak(dates: Set<string>, step: number): number {
  const sorted = [...dates].sort();
  let longest = 0;
  let current = 0;
  let previous = '';
  for (const day of sorted) {
    current =
      previous && addCalendarDays(previous, step) === day ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

/** Current streak tolerates an unfinished today/week; longest is historical. */
export function activityStreaks(
  activities: readonly DatedActivity[],
  today: string
) {
  const days = new Set(activities.map((a) => activityDay(a.start_date_local)));
  const todayOrYesterday = days.has(today) ? today : addCalendarDays(today, -1);
  const weeks = new Set([...days].map(mondayOf));
  const currentMonday = mondayOf(today);
  const startMonday = weeks.has(currentMonday)
    ? currentMonday
    : addCalendarDays(currentMonday, -7);
  return {
    currentDays: consecutiveLength(days, todayOrYesterday, 1),
    longestDays: longestStreak(days, 1),
    currentWeeks: consecutiveLength(weeks, startMonday, 7),
    longestWeeks: longestStreak(weeks, 7),
  };
}

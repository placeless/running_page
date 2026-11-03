import { memo } from 'react';
import type { Activity } from '../types';
import { useLocale } from '../hooks/useLocale';
import approved from '../static/races.json';
import {
  resolveApprovedRaces,
  type ApprovedRaceCatalog,
} from '../core/domain/races';
import { parseMovingTime } from '../core/domain/metrics';

interface Props {
  activities: Activity[];
  onSelectActivity?: (activity: Activity | null) => void;
}

function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours
    ? hours +
        ':' +
        String(minutes).padStart(2, '0') +
        ':' +
        String(remainder).padStart(2, '0')
    : minutes + ':' + String(remainder).padStart(2, '0');
}

export const RaceRecords = memo(function RaceRecords({
  activities,
  onSelectActivity,
}: Props) {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const races = resolveApprovedRaces(
    activities,
    approved as ApprovedRaceCatalog
  );
  if (!races.length) return null;

  return (
    <section
      aria-label={zh ? '审核通过的赛事记录' : 'Approved race records'}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3"
    >
      <h3 className="mb-2 text-sm font-semibold">
        {zh ? '赛事记录' : 'Race Records'}
      </h3>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        {zh
          ? '仅展示明确批准的赛事；赛事距离与 GPS 距离分别记录，不根据 GPS 推算官方成绩。'
          : 'Only approved races. Event distance and recorded GPS distance are separate; no estimated official results.'}
      </p>
      <div className="divide-y divide-[var(--color-border)]">
        {races.map(({ race, activity }) => (
          <button
            key={race.activity.date + ':' + race.activity.moving_time}
            type="button"
            disabled={!onSelectActivity}
            onClick={() => onSelectActivity?.(activity)}
            className="w-full rounded-lg py-2 text-left transition-colors hover:bg-[var(--color-bg)] disabled:cursor-default disabled:hover:bg-transparent"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--color-text)]">
                  {race.name}
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {race.activity.date} · {zh ? '赛事' : 'Event'}{' '}
                  {race.race_distance_m / 1000} km
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-bold text-[var(--color-accent)]">
                  {race.official_time_seconds === null
                    ? zh
                      ? '未提供'
                      : 'Not supplied'
                    : formatClock(race.official_time_seconds)}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {zh ? '官方成绩' : 'Official time'}
                </div>
              </div>
            </div>
            <div className="mt-2 text-xs text-[var(--color-muted)]">
              {zh ? 'GPS 记录' : 'Recorded GPS'}:{' '}
              {(activity.distance / 1000).toFixed(2)} km ·{' '}
              {formatClock(parseMovingTime(activity.moving_time))}{' '}
              {zh ? '移动时间' : 'moving time'}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
});

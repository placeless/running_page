import { memo } from 'react';
import type { Activity } from '../types';
import { useLocale } from '../hooks/useLocale';
import { matchedFullRuns } from '../core/domain/bests';

interface MatchedRunTimesProps {
  activities: Activity[];
  onSelectActivity?: (a: Activity | null) => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const MatchedRunTimes = memo(function MatchedRunTimes({
  activities,
  onSelectActivity,
}: MatchedRunTimesProps) {
  const { locale } = useLocale();

  const labels: Record<string, string> =
    locale === 'zh'
      ? {
          '5K': '5公里',
          '10K': '10公里',
          'Half Marathon': '半程马拉松',
          Marathon: '全程马拉松',
        }
      : {
          '5K': '5K',
          '10K': '10K',
          'Half Marathon': 'Half Marathon',
          Marathon: 'Marathon',
        };

  const bests = matchedFullRuns(activities);

  const hasBests = bests.some((b) => b.activity !== null);
  if (!hasBests) return null;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/5 hover:shadow-[var(--color-accent)]/5 hover:shadow-lg">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <svg
          className="h-4 w-4 text-[var(--color-accent)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </svg>
        {locale === 'zh' ? '近标准距离最快活动' : 'Fastest Matched Activities'}
      </h3>
      <p className="mb-2 text-xs text-[var(--color-muted)]">
        {locale === 'zh'
          ? '匹配标准距离附近（含合理超出）的完整活动；显示全程移动时间，并非精确分段或官方 PB。'
          : 'Fastest full activities near or above each distance; moving time, not an exact split or official PB.'}
      </p>

      <div className="divide-y divide-[var(--color-border)]">
        {bests.map(({ key, activity, seconds }) => (
          <button
            type="button"
            disabled={!activity || !onSelectActivity}
            key={key}
            className={`flex w-full items-center justify-between gap-3 py-2 text-left ${
              activity
                ? '-mx-2 cursor-pointer rounded-lg px-2 transition-colors hover:bg-[var(--color-bg)]'
                : ''
            }`}
            onClick={() => activity && onSelectActivity?.(activity)}
          >
            <span className="text-xs text-[var(--color-text)]">
              {labels[key]}
              {activity && (
                <span className="ml-1 text-[var(--color-muted)]">
                  ({(activity.distance / 1000).toFixed(2)} km)
                </span>
              )}
            </span>
            <span
              className={`font-mono text-xs font-bold ${activity ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}
            >
              {activity ? formatTime(seconds) : '--'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});

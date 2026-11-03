import { useState } from 'react';
import type { Activity } from '../types';
import { hasRoute } from '../core/routeFallback';
import { useLocale } from '../hooks/useLocale';

/** A map failure should never hide the recorded activities or their details. */
export function RouteMapUnavailable({
  activities,
  onSelectActivity,
  onRetry,
  embedded = false,
}: {
  activities: Activity[];
  onSelectActivity?: (activity: Activity) => void;
  onRetry: () => void;
  embedded?: boolean;
}) {
  const { locale } = useLocale();
  const [showAll, setShowAll] = useState(false);
  const mapped = activities.filter(hasRoute);
  const shown = showAll ? mapped : mapped.slice(0, 12);
  const zh = locale === 'zh';
  return (
    <section
      className={
        embedded
          ? 'p-4'
          : 'route-map rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4'
      }
      aria-label={zh ? '路线地图备用视图' : 'Route map fallback'}
    >
      <h2 className="text-base font-semibold">
        {zh ? '地图暂不可用' : 'Map unavailable'}
      </h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]" role="status">
        {zh
          ? '无法启动或显示 WebGL 地图。运动记录仍可访问。'
          : 'WebGL map could not start or render. Activity details remain available.'}
      </p>
      <button type="button" className="route-map-action mt-3" onClick={onRetry}>
        {zh ? '重试地图' : 'Retry map'}
      </button>
      {mapped.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            {mapped.length} {zh ? '条有路线的运动记录' : 'mapped activities'}
          </p>
          <ul className="max-h-64 space-y-1 overflow-auto">
            {shown.map((activity) => (
              <li key={activity.run_id}>
                {onSelectActivity ? (
                  <button
                    type="button"
                    onClick={() => onSelectActivity(activity)}
                    className="w-full rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-bg)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                  >
                    {activity.start_date_local.slice(0, 10)} · {activity.type} ·{' '}
                    {(activity.distance / 1000).toFixed(1)} km
                  </button>
                ) : (
                  <span className="block px-2 py-2 text-sm">
                    {activity.start_date_local.slice(0, 10)} · {activity.type} ·{' '}
                    {(activity.distance / 1000).toFixed(1)} km
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!showAll && mapped.length > shown.length && (
            <button
              type="button"
              className="route-map-action mt-2"
              onClick={() => setShowAll(true)}
            >
              {zh ? '显示全部记录' : 'Show all activities'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

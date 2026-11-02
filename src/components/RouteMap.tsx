import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { RouteMapProps } from './RouteMapCanvas';
import { useLocale } from '../hooks/useLocale';

const MapCanvas = lazy(() =>
  import('./RouteMapCanvas').then((module) => ({
    default: module.RouteMapCanvas,
  }))
);

/** Load WebGL and decode routes only as the map approaches the viewport. */
export function RouteMap(props: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { locale } = useLocale();
  const publicRoutesAvailable = (props.allActivities ?? props.activities).some(
    (activity) =>
      activity.route_segments
        ? activity.route_segments.length > 0
        : !!activity.summary_polyline
  );
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const placeholder = (
    <div
      className="flex h-[442px] items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-sm text-[var(--color-muted)]"
      role="status"
    >
      {locale === 'zh' ? '正在加载地图…' : 'Loading map…'}
    </div>
  );
  if (!publicRoutesAvailable) {
    return (
      <section className="route-map rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <h2 className="mb-2 text-base font-semibold">
          {locale === 'zh' ? '路线地图' : 'Route map'}
        </h2>
        <p className="text-sm text-[var(--color-muted)]" role="status">
          {locale === 'zh'
            ? 'GPS 路线暂不公开。运动统计与地区足迹仍可查看。'
            : 'GPS routes are private. Activity statistics and regional footprints remain available.'}
        </p>
      </section>
    );
  }
  return (
    <div ref={containerRef}>
      <Suspense fallback={placeholder}>
        {visible || props.selectedActivity ? (
          <MapCanvas {...props} />
        ) : (
          placeholder
        )}
      </Suspense>
    </div>
  );
}

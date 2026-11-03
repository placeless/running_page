import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { RouteMapProps } from './RouteMapCanvas';
import { useLocale } from '../hooks/useLocale';
import { hasRoute } from '../core/routeFallback';
import type { Activity } from '../types';
import { RouteMapUnavailable } from './RouteMapUnavailable';

const MapCanvas = lazy(() =>
  import('./RouteMapCanvas').then((module) => ({
    default: module.RouteMapCanvas,
  }))
);

/** Map-specific crash boundary: a WebGL failure must not unmount the page. */
class MapErrorBoundary extends Component<
  {
    children: ReactNode;
    activities: Activity[];
    onSelectActivity?: (activity: Activity) => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Never print the current activity or private route coordinates.
    console.warn(
      'Map renderer unavailable:',
      error instanceof Error ? error.name : 'unknown'
    );
  }

  render() {
    if (this.state.failed) {
      return (
        <RouteMapUnavailable
          activities={this.props.activities}
          onSelectActivity={this.props.onSelectActivity}
          onRetry={() => this.setState({ failed: false })}
        />
      );
    }
    return this.props.children;
  }
}

/** Load WebGL and decode routes only as the map approaches the viewport. */
export function RouteMap(props: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { locale } = useLocale();
  const publicRoutesAvailable = (props.allActivities ?? props.activities).some(
    hasRoute
  );
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let active = true;
    let observer: IntersectionObserver | null = null;
    try {
      if (typeof IntersectionObserver === 'undefined')
        throw new Error('IntersectionObserver unavailable');
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer?.disconnect();
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(element);
    } catch {
      // Unsupported observers should not block a route map or the page.
      queueMicrotask(() => {
        if (active) setVisible(true);
      });
    }
    return () => {
      active = false;
      observer?.disconnect();
    };
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
  if (!props.selectedActivity && !props.activities.some(hasRoute)) {
    return (
      <section className="route-map rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <h2 className="mb-2 text-base font-semibold">
          {locale === 'zh' ? '路线地图' : 'Route map'}
        </h2>
        <p role="status" className="text-sm text-[var(--color-muted)]">
          {locale === 'zh'
            ? '当前筛选中没有可显示的路线。'
            : 'No mapped activities match the current filters.'}
        </p>
      </section>
    );
  }
  return (
    <div ref={containerRef}>
      <MapErrorBoundary
        activities={
          props.selectedActivity
            ? (props.allActivities ?? props.activities)
            : props.activities
        }
        onSelectActivity={props.onSelectActivity}
      >
        <Suspense fallback={placeholder}>
          {visible || props.selectedActivity ? (
            <MapCanvas {...props} />
          ) : (
            placeholder
          )}
        </Suspense>
      </MapErrorBoundary>
    </div>
  );
}

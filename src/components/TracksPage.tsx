import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportCard } from '../utils/exportCard';
import { RouteMap } from './RouteMap';
import { thumbnailPaths } from '../core/routeGeometry';
import { hasRoute } from '../core/routeFallback';
import type { Activity } from '../types';
import {
  getAvailableYears,
  formatDistance,
  parseMovingTime,
  formatPace,
} from '../hooks/useActivities';
import { useLocale } from '../hooks/useLocale';
import { activityYear } from '../core/domain/calendar';
import { runningMovement } from '../core/domain/metrics';

type SportType = 'Run';
const trackPlaceholders = Array.from({ length: 40 }, (_, id) => ({
  id,
  delay: id * 20,
}));

interface TracksPageProps {
  activities: Activity[];
  filter: string;
  dark?: boolean;
  onBack: () => void;
  onSelectActivity?: (a: Activity | null) => void;
}

const TrackThumb = memo(function TrackThumb({
  activity,
  color,
  selected,
  onClick,
}: {
  activity: Activity;
  color: string;
  selected: boolean;
  onClick: (activity: Activity) => void;
}) {
  const size = 80;
  const paths = useMemo(() => thumbnailPaths(activity, size), [activity]);
  if (!paths.length) return null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${activity.start_date_local.slice(0, 16)} · ${activity.name} · ${(activity.distance / 1000).toFixed(1)} km`}
      className={`track-thumb group relative cursor-pointer rounded transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]' : ''}`}
      onClick={() => onClick(activity)}
      title={`${activity.name} — ${(activity.distance / 1000).toFixed(1)} km`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={`transition-opacity ${selected ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}
      >
        {paths.map((points) => (
          <polyline
            key={points}
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={selected ? '2' : '1.5'}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </button>
  );
});

function getColor(a: Activity): string {
  if (a.type === 'Run') {
    const km = a.distance / 1000;
    return km >= 20 ? '#ef4444' : '#f97316';
  }
  return '#4dd2ff';
}

export function TracksPage({
  activities,
  onBack,
  dark,
  onSelectActivity,
}: TracksPageProps) {
  const { locale } = useLocale();
  const allYears = useMemo(() => getAvailableYears(activities), [activities]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [sportFilter, setSportFilter] = useState<SportType | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(
    null
  );
  const [sortBy, setSortBy] = useState<'date' | 'distance'>('date');

  // Export
  const captureRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportUrl, setExportUrl] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  // Year pagination
  const MAX_YEARS = 10;
  const [yearPage, setYearPage] = useState(0);
  const totalYearPages = Math.ceil(allYears.length / MAX_YEARS);
  const visibleYears = allYears.slice(
    yearPage * MAX_YEARS,
    yearPage * MAX_YEARS + MAX_YEARS
  );

  // Determine which sport types exist
  const hasSport = (t: SportType) => activities.some((a) => a.type === t);

  // Filtered base (year + sport)
  const base = useMemo(
    () =>
      activities.filter((a) => {
        if (
          selectedYear !== null &&
          activityYear(a.start_date_local) !== selectedYear
        )
          return false;
        if (sportFilter !== null && a.type !== sportFilter) return false;
        return true;
      }),
    [activities, selectedYear, sportFilter]
  );

  const withPolyline = useMemo(() => base.filter(hasRoute), [base]);

  const { totalDist, totalTime, avgPace } = useMemo(() => {
    let totalDist = 0,
      totalTime = 0;
    for (const activity of base) {
      totalDist += activity.distance;
      totalTime += parseMovingTime(activity.moving_time);
    }
    return {
      totalDist,
      totalTime,
      avgPace: runningMovement(base).speed,
    };
  }, [base]);

  // Defer geometry-based grouping to the worker, but preserve every member.
  type Cluster = {
    representative: Activity;
    members: Activity[];
    color: string;
  };
  const [clusteredTracks, setClusteredTracks] = useState<Cluster[]>([]);
  const [clusteredInput, setClusteredInput] = useState<Activity[] | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<number>>(
    () => new Set()
  );
  const clustering = withPolyline.length > 0 && clusteredInput !== withPolyline;
  const currentClusters = withPolyline.length ? clusteredTracks : [];

  useEffect(() => {
    let active = true;
    let worker: Worker | null = null;
    const fallback = () => {
      if (!active) return;
      setClusteredTracks(
        withPolyline.map((representative) => ({
          representative,
          members: [representative],
          color: getColor(representative),
        }))
      );
      setClusteredInput(withPolyline);
    };
    if (!withPolyline.length) {
      return () => {
        active = false;
      };
    }
    try {
      worker = new Worker(
        new URL('../workers/clusterTracks.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = ({ data }: MessageEvent<number[][]>) => {
        if (!active) return;
        const next = data.flatMap((indexes) => {
          const members = indexes
            .map((index) => withPolyline[index])
            .filter((member): member is Activity => !!member);
          if (!members.length) return [];
          const representative = members[0];
          return [
            {
              representative,
              members,
              color: getColor(representative),
            },
          ];
        });
        // If a worker returned an incomplete set, retain accessibility.
        const included = new Set(next.flatMap((group) => group.members));
        for (const representative of withPolyline) {
          if (!included.has(representative))
            next.push({
              representative,
              members: [representative],
              color: getColor(representative),
            });
        }
        setClusteredTracks(next);
        setClusteredInput(withPolyline);
      };
      worker.onerror = fallback;
      worker.postMessage(
        withPolyline.map(
          ({
            summary_polyline,
            route_segments,
            start_date_local,
            distance,
          }) => ({
            summary_polyline,
            route_segments,
            start_date_local,
            distance,
          })
        )
      );
    } catch {
      // Worker construction and postMessage can also fail on some browsers.
      worker?.terminate();
      worker = null;
      queueMicrotask(fallback);
    }
    return () => {
      active = false;
      worker?.terminate();
    };
  }, [withPolyline]);

  const sortedTracks = useMemo(
    () =>
      withPolyline.length
        ? [...clusteredTracks].sort((a, b) =>
            sortBy === 'distance'
              ? b.representative.distance - a.representative.distance
              : b.representative.start_date_local.localeCompare(
                  a.representative.start_date_local
                )
          )
        : [],
    [clusteredTracks, sortBy, withPolyline.length]
  );

  const handleSelectTrack = useCallback(
    (a: Activity) => {
      const next = selectedActivity?.run_id === a.run_id ? null : a;
      setSelectedActivity(next);
      onSelectActivity?.(next);
      if (next && window.matchMedia('(max-width: 1023px)').matches) {
        requestAnimationFrame(() =>
          previewRef.current?.scrollIntoView({
            block: 'start',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
              .matches
              ? 'instant'
              : 'smooth',
          })
        );
      }
    },
    [selectedActivity, onSelectActivity]
  );

  const selectedSeconds = selectedActivity
    ? parseMovingTime(selectedActivity.moving_time)
    : 0;
  const selectedDurationLabel = `${Math.floor(selectedSeconds / 3600) ? Math.floor(selectedSeconds / 3600) + 'h ' : ''}${Math.floor((selectedSeconds % 3600) / 60)}m`;

  const allSportTabs: { label: string; value: SportType; color: string }[] = [
    { label: locale === 'zh' ? '跑步' : 'Run', value: 'Run', color: '#f97316' },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
      {/* Top bar: back + title */}
      <div className="mb-5 flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex shrink-0 items-center gap-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          {locale === 'zh' ? '返回' : 'Back'}
        </button>
        <h1 className="shrink-0 text-lg font-bold">
          {locale === 'zh' ? '轨迹墙' : 'Track Wall'}
        </h1>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[340px_1fr]">
        {/* Left: stats + map */}
        <div
          ref={previewRef}
          className="flex scroll-mt-28 flex-col gap-4 lg:sticky lg:top-24"
        >
          {/* Stats card */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <p className="mb-3 text-[10px] tracking-wider text-[var(--color-muted)] uppercase">
              {selectedYear ?? (locale === 'zh' ? '全部' : 'Total')}
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
              <div>
                <p className="text-[10px] tracking-wider text-[var(--color-muted)] uppercase">
                  {locale === 'zh' ? '活动' : 'Activities'}
                </p>
                <p className="font-mono text-2xl font-bold text-[var(--color-accent)]">
                  {base.length}
                </p>
              </div>
              <div>
                <p className="text-[10px] tracking-wider text-[var(--color-muted)] uppercase">
                  {locale === 'zh' ? '距离' : 'Distance'}
                </p>
                <p className="font-mono text-2xl font-bold">
                  {formatDistance(totalDist)}{' '}
                  <span className="text-sm font-normal text-[var(--color-muted)]">
                    km
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[10px] tracking-wider text-[var(--color-muted)] uppercase">
                  {locale === 'zh' ? '时间' : 'Time'}
                </p>
                <p className="font-mono text-lg font-bold">
                  {Math.floor(totalTime / 3600)}h{' '}
                  {Math.floor((totalTime % 3600) / 60)}m
                </p>
              </div>
              {avgPace > 0 && (
                <div>
                  <p className="text-[10px] tracking-wider text-[var(--color-muted)] uppercase">
                    {locale === 'zh' ? '跑步均配速' : 'Run Pace'}
                  </p>
                  <p className="font-mono text-lg font-bold">
                    {formatPace(avgPace)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Activity detail — only when a single track is selected */}
          {selectedActivity && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] tracking-wider text-[var(--color-muted)] uppercase">
                  {locale === 'zh' ? '已选记录' : 'Selected'}
                </p>
                <button
                  aria-label={
                    locale === 'zh' ? '清除选中轨迹' : 'Clear selected track'
                  }
                  onClick={() => {
                    setSelectedActivity(null);
                    onSelectActivity?.(null);
                  }}
                  className="text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <p className="mb-0.5 truncate text-xs font-semibold">
                {selectedActivity.name}
              </p>
              <p className="mb-2 text-[10px] text-[var(--color-muted)]">
                {new Date(
                  selectedActivity.start_date_local.slice(0, 10) + 'T12:00:00'
                ).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                {selectedActivity.start_date_local.length > 10 &&
                  new Date(
                    selectedActivity.start_date_local
                  ).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] tracking-wider text-[var(--color-muted)] uppercase">
                    {locale === 'zh' ? '距离' : 'Distance'}
                  </p>
                  <p className="font-mono text-base leading-tight font-bold">
                    {(selectedActivity.distance / 1000).toFixed(2)}{' '}
                    <span className="text-[10px] font-normal text-[var(--color-muted)]">
                      km
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wider text-[var(--color-muted)] uppercase">
                    {locale === 'zh' ? '时间' : 'Time'}
                  </p>
                  <p className="font-mono text-base leading-tight font-bold">
                    {selectedDurationLabel}
                  </p>
                </div>
                {selectedActivity.average_speed > 0 && (
                  <div>
                    <p className="text-[9px] tracking-wider text-[var(--color-muted)] uppercase">
                      {locale === 'zh' ? '配速' : 'Pace'}
                    </p>
                    <p className="font-mono text-base leading-tight font-bold">
                      {formatPace(selectedActivity.average_speed)}{' '}
                      <span className="text-[10px] font-normal text-[var(--color-muted)]">
                        /km
                      </span>
                    </p>
                  </div>
                )}
                {selectedActivity.elevation_gain != null &&
                  selectedActivity.elevation_gain > 0 && (
                    <div>
                      <p className="text-[9px] tracking-wider text-[var(--color-muted)] uppercase">
                        {locale === 'zh' ? '爬升' : 'Elev'}
                      </p>
                      <p className="font-mono text-base leading-tight font-bold">
                        {Math.round(selectedActivity.elevation_gain)}{' '}
                        <span className="text-[10px] font-normal text-[var(--color-muted)]">
                          m
                        </span>
                      </p>
                    </div>
                  )}
                {selectedActivity.average_heartrate != null &&
                  selectedActivity.average_heartrate > 0 && (
                    <div>
                      <p className="text-[9px] tracking-wider text-[var(--color-muted)] uppercase">
                        {locale === 'zh' ? '心率' : 'HR'}
                      </p>
                      <p className="font-mono text-base leading-tight font-bold">
                        {Math.round(selectedActivity.average_heartrate)}{' '}
                        <span className="text-[10px] font-normal text-[var(--color-muted)]">
                          bpm
                        </span>
                      </p>
                    </div>
                  )}
              </div>
            </div>
          )}

          <RouteMap
            activities={withPolyline}
            allActivities={activities}
            selectedActivity={selectedActivity}
            onSelectActivity={handleSelectTrack}
            dark={dark}
            onClearSelection={() => {
              setSelectedActivity(null);
              onSelectActivity?.(null);
            }}
          />
        </div>

        {/* Right: track grid with year filter inside */}
        <div className="min-w-0">
          <div
            ref={captureRef}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          >
            {/* Year pills + sport filter */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] pb-3">
              {totalYearPages > 1 && (
                <button
                  aria-label={locale === 'zh' ? '较新的年份' : 'Newer years'}
                  onClick={() => setYearPage((p) => Math.max(0, p - 1))}
                  disabled={yearPage === 0}
                  className="min-h-9 min-w-9 px-1 text-base leading-none text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-30"
                >
                  ‹
                </button>
              )}
              <button
                aria-pressed={selectedYear === null}
                onClick={() => {
                  setExportUrl('');
                  setExportMessage('');
                  setSelectedYear(null);
                  setSelectedActivity(null);
                  onSelectActivity?.(null);
                }}
                className={`inline-flex min-h-9 items-center rounded-full px-3 py-1 text-xs font-medium ${selectedYear === null ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
              >
                {locale === 'zh' ? '全部' : 'All'}
              </button>
              {visibleYears.map((yr) => (
                <button
                  key={yr}
                  aria-pressed={selectedYear === yr}
                  onClick={() => {
                    setExportUrl('');
                    setExportMessage('');
                    setSelectedYear(yr);
                    setSelectedActivity(null);
                    onSelectActivity?.(null);
                  }}
                  className={`inline-flex min-h-9 items-center rounded-full px-3 py-1 text-xs font-medium ${selectedYear === yr ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                >
                  {yr}
                </button>
              ))}
              {totalYearPages > 1 && (
                <button
                  onClick={() =>
                    setYearPage((p) => Math.min(totalYearPages - 1, p + 1))
                  }
                  aria-label={locale === 'zh' ? '较早的年份' : 'Older years'}
                  disabled={yearPage === totalYearPages - 1}
                  className="min-h-9 min-w-9 px-1 text-base leading-none text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-30"
                >
                  ›
                </button>
              )}
              {/* Sport filter — right side */}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  aria-pressed={sportFilter === null}
                  onClick={() => {
                    setExportUrl('');
                    setExportMessage('');
                    setSportFilter(null);
                    setSelectedActivity(null);
                    onSelectActivity?.(null);
                  }}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-xs font-medium ${sportFilter === null ? 'border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)]' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                >
                  {locale === 'zh' ? '全部' : 'All'}
                </button>
                {allSportTabs
                  .filter((t) => hasSport(t.value))
                  .map(({ label, value, color }) => (
                    <button
                      key={value}
                      aria-pressed={sportFilter === value}
                      onClick={() => {
                        setExportUrl('');
                        setExportMessage('');
                        setSportFilter(value);
                        setSelectedActivity(null);
                        onSelectActivity?.(null);
                      }}
                      className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-xs font-medium ${sportFilter === value ? 'border-transparent text-[#171717]' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                      style={
                        sportFilter === value ? { backgroundColor: color } : {}
                      }
                    >
                      {label}
                    </button>
                  ))}
                <span className="mx-1 h-3 w-px bg-[var(--color-border)]" />
                <button
                  onClick={async () => {
                    if (!captureRef.current || exporting) return;
                    setExporting(true);
                    setExportMessage('');
                    try {
                      setExportUrl(
                        await exportCard(
                          captureRef.current,
                          `tracks-${selectedYear ?? 'all'}.png`
                        )
                      );
                      setExportMessage(
                        locale === 'zh' ? '图片已生成' : 'Image ready'
                      );
                    } catch (err) {
                      console.error('Export failed:', err);
                      setExportMessage(
                        locale === 'zh'
                          ? '导出失败，请重试'
                          : 'Export failed. Please retry.'
                      );
                    } finally {
                      setExporting(false);
                    }
                  }}
                  data-export-hidden
                  disabled={exporting || clustering || !currentClusters.length}
                  className="flex h-9 w-9 items-center justify-center rounded text-[var(--color-muted)] transition-all hover:text-[var(--color-text)] disabled:opacity-50"
                  title={locale === 'zh' ? '导出图片' : 'Export as image'}
                >
                  {exporting ? (
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {exportMessage && (
              <p
                role="status"
                data-export-hidden
                className="mb-3 text-xs text-[var(--color-muted)]"
              >
                {exportMessage}
                {exportUrl && (
                  <a
                    href={exportUrl}
                    download={`tracks-${selectedYear ?? 'all'}.png`}
                    className="ml-3 underline"
                  >
                    {locale === 'zh' ? '下载图片' : 'Download image'}
                  </a>
                )}
              </p>
            )}
            {clustering ? (
              <div className="flex flex-wrap gap-1">
                {trackPlaceholders.map((placeholder) => (
                  <div
                    key={placeholder.id}
                    className="h-[80px] w-[80px] animate-pulse rounded bg-[var(--color-border)] motion-reduce:animate-none"
                    style={{ animationDelay: `${placeholder.delay}ms` }}
                  />
                ))}
              </div>
            ) : currentClusters.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-muted)]">
                {locale === 'zh' ? '暂无轨迹数据' : 'No tracks found'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {sortedTracks.map(({ representative: a, members, color }) => {
                  const expanded =
                    expandedClusters.has(a.run_id) ||
                    members.some(
                      (member) =>
                        member.run_id !== a.run_id &&
                        member.run_id === selectedActivity?.run_id
                    );
                  return (
                    <div key={a.run_id} className="track-cell relative">
                      <TrackThumb
                        activity={a}
                        color={color}
                        selected={selectedActivity?.run_id === a.run_id}
                        onClick={handleSelectTrack}
                      />
                      {members.length > 1 && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={
                            locale === 'zh'
                              ? `展开或收起 ${members.length} 条相似路线`
                              : `Expand or collapse ${members.length} similar routes`
                          }
                          className="mt-1 block min-h-8 w-full rounded border border-[var(--color-border)] px-1 py-1 text-center text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
                          onClick={() =>
                            setExpandedClusters((old) => {
                              const next = new Set(old);
                              if (next.has(a.run_id)) next.delete(a.run_id);
                              else next.add(a.run_id);
                              return next;
                            })
                          }
                        >
                          {expanded ? '−' : '+'} {members.length}
                        </button>
                      )}
                      {expanded && members.length > 1 && (
                        <div
                          role="group"
                          aria-label={
                            locale === 'zh'
                              ? '相似路线成员'
                              : 'Similar route members'
                          }
                          className="mt-1 flex flex-wrap gap-1"
                        >
                          {members.slice(1).map((member) => (
                            <TrackThumb
                              key={member.run_id}
                              activity={member}
                              color={getColor(member)}
                              selected={
                                selectedActivity?.run_id === member.run_id
                              }
                              onClick={handleSelectTrack}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Legend + sort */}
            {!clustering && currentClusters.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]">
                {sportFilter === null || sportFilter === 'Run' ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3 rounded bg-[#f97316]" />
                      {locale === 'zh' ? '跑步' : 'Run'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3 rounded bg-[#ef4444]" />
                      {locale === 'zh' ? '跑步 ≥20km' : 'Run ≥20km'}
                    </span>
                  </>
                ) : null}
                {null}
                {null}
                <div className="ml-auto flex items-center gap-1">
                  <span>
                    {withPolyline.length}{' '}
                    {locale === 'zh' ? '条路线' : 'routes'}
                  </span>
                  <span className="mx-1.5 text-[var(--color-border)]">·</span>
                  <button
                    aria-pressed={sortBy === 'date'}
                    onClick={() => setSortBy('date')}
                    className={`transition-colors ${sortBy === 'date' ? 'font-medium text-[var(--color-text)]' : 'hover:text-[var(--color-text)]'}`}
                  >
                    {locale === 'zh' ? '时间' : 'Date'}
                  </button>
                  <span className="text-[var(--color-border)]">/</span>
                  <button
                    aria-pressed={sortBy === 'distance'}
                    onClick={() => setSortBy('distance')}
                    className={`transition-colors ${sortBy === 'distance' ? 'font-medium text-[var(--color-text)]' : 'hover:text-[var(--color-text)]'}`}
                  >
                    {locale === 'zh' ? '距离' : 'Dist'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* end track grid card */}
        </div>
        {/* end right column */}
      </div>
    </div>
  );
}

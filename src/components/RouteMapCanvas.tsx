import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Activity } from '../types';
import { hasRoute, routeForActivity } from '../core/routeFallback';
import { decodedRouteSegments } from '../core/routeGeometry';
import { routeViewport, type RouteView } from '../core/routeViewport';
import { MAPBOX_TOKEN } from '../config';
import { useLocale } from '../hooks/useLocale';
import { RouteMapUnavailable } from './RouteMapUnavailable';
import './RouteMap.css';

export interface RouteMapProps {
  activities: Activity[];
  allActivities?: Activity[];
  selectedActivity?: Activity | null;
  dark?: boolean;
  onClearSelection?: () => void;
  onSelectActivity?: (activity: Activity) => void;
}

const routeCache = new WeakMap<
  Activity,
  {
    type: 'Feature';
    properties: { type: string };
    geometry: { type: 'LineString'; coordinates: number[][] };
  }[]
>();

export function RouteMapCanvas({
  activities,
  allActivities = activities,
  selectedActivity,
  dark,
  onClearSelection,
  onSelectActivity,
}: RouteMapProps) {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const panelRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleReadyRef = useRef(false);
  const cameraRef = useRef<mapboxgl.CameraOptions | null>(null);
  const fittedRef = useRef<{ routes: unknown; view: RouteView } | null>(null);
  const [provider, setProvider] = useState<'mapbox' | 'carto' | 'plain'>(
    MAPBOX_TOKEN ? 'mapbox' : 'carto'
  );
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [preferredView, setPreferredView] = useState<{
    scope: Activity[];
    view: RouteView;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  // Mapbox GL JS v2+ requires a token even for external basemaps.
  // Use MapLibre for CARTO and the built-in plain style.
  const useMapbox = provider === 'mapbox' && !!MAPBOX_TOKEN;
  const style = useMemo<string | mapboxgl.StyleSpecification>(
    () =>
      provider === 'mapbox'
        ? `mapbox://styles/mapbox/${dark === false ? 'light' : 'dark'}-v11`
        : provider === 'carto'
          ? `https://basemaps.cartocdn.com/gl/${dark === false ? 'positron' : 'dark-matter'}-gl-style/style.json`
          : {
              version: 8,
              sources: {},
              layers: [
                {
                  id: 'background',
                  type: 'background',
                  paint: {
                    'background-color': dark === false ? '#f5f5f5' : '#171717',
                  },
                },
              ],
            },
    [provider, dark]
  );

  const displayActivity = useMemo(
    () =>
      selectedActivity
        ? routeForActivity(selectedActivity, allActivities)
        : null,
    [selectedActivity, allActivities]
  );
  const fallbackActivity =
    selectedActivity && !hasRoute(selectedActivity) ? displayActivity : null;

  const routeActivities = useMemo(
    () =>
      selectedActivity
        ? displayActivity
          ? [displayActivity]
          : []
        : activities,
    [selectedActivity, displayActivity, activities]
  );

  const routeGroups = useMemo(() => {
    return routeActivities.flatMap((activity) => {
      const cached = routeCache.get(activity);
      if (cached) return cached.length ? [cached] : [];
      const features = decodedRouteSegments(activity).map((points) => ({
        type: 'Feature' as const,
        properties: { type: activity.type },
        geometry: {
          type: 'LineString' as const,
          coordinates: points.map(([lat, lng]) => [lng, lat]),
        },
      }));
      routeCache.set(activity, features);
      return features.length ? [features] : [];
    });
  }, [routeActivities]);
  const routes = useMemo(() => routeGroups.flat(), [routeGroups]);
  const routeStarts = useMemo(
    () => routeGroups.map((parts) => parts[0].geometry.coordinates[0]),
    [routeGroups]
  );

  const routeBounds = useMemo(() => {
    const bounds = new mapboxgl.LngLatBounds();
    for (const route of routes) {
      for (const coord of route.geometry.coordinates)
        bounds.extend(coord as [number, number]);
    }
    return bounds;
  }, [routes]);

  const latestRoute = useMemo(() => {
    if (selectedActivity) return null;
    const latest = [...activities]
      .filter((activity) => hasRoute(activity))
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0];
    return (latest && routeCache.get(latest)?.[0]) || null;
  }, [activities, selectedActivity]);

  const coverage = useMemo(
    () =>
      routeViewport(
        routeStarts as [number, number][],
        (latestRoute?.geometry.coordinates[0] as [number, number]) ?? null
      ),
    [routeStarts, latestRoute]
  );
  const view: RouteView = selectedActivity
    ? 'region'
    : preferredView?.scope === activities
      ? preferredView.view
      : coverage.initialView;

  const regionalBounds = useMemo(() => {
    if (coverage.initialView !== 'world' || selectedActivity)
      return routeBounds;
    const bounds = new mapboxgl.LngLatBounds();
    for (const index of coverage.nearbyRouteIndices) {
      for (const part of routeGroups[index])
        for (const point of part.geometry.coordinates)
          bounds.extend(point as [number, number]);
    }
    return bounds.isEmpty() ? routeBounds : bounds;
  }, [coverage, routeGroups, routeBounds, selectedActivity]);

  const fitRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map || routeBounds.isEmpty()) return;
    // Both renderers accept coordinate pairs; their LngLatBounds classes are
    // not interchangeable at runtime.
    map.fitBounds(routeBounds.toArray(), {
      padding: { top: 35, bottom: 35, left: 35, right: 65 },
      maxZoom: selectedActivity ? 16 : 13,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 500,
    });
  }, [routeBounds, selectedActivity]);

  const focusRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (regionalBounds.isEmpty()) return;
    map.fitBounds(regionalBounds.toArray(), {
      padding: { top: 40, bottom: 40, left: 40, right: 60 },
      maxZoom: 8,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 500,
    });
  }, [regionalBounds]);

  const drawRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const data = { type: 'FeatureCollection' as const, features: routes };
    const source = map.getSource('routes') as
      mapboxgl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource('routes', { type: 'geojson', data });
      map.addLayer({
        id: 'routes',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'type'],
            'Run',
            '#f97316',
            'Ride',
            '#3b82f6',
            '#4dd2ff',
          ],
        },
      });
    }
    map.setPaintProperty('routes', 'line-width', selectedActivity ? 3.5 : 2);
    map.setPaintProperty('routes', 'line-opacity', selectedActivity ? 1 : 0.7);
    // Show route density when worldwide lines become too small to see.
    const locationData = {
      type: 'FeatureCollection' as const,
      features: routeStarts.map((start) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Point' as const,
          coordinates: start,
        },
      })),
    };
    const locations = map.getSource('route-locations') as
      mapboxgl.GeoJSONSource | undefined;
    if (locations) locations.setData(locationData);
    else {
      map.addSource('route-locations', {
        type: 'geojson',
        data: locationData,
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 6,
      });
      map.addLayer({
        id: 'route-clusters',
        type: 'circle',
        source: 'route-locations',
        filter: ['has', 'point_count'],
        maxzoom: 6,
        paint: {
          'circle-color': '#f97316',
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            12,
            20,
            17,
            100,
            23,
          ],
          'circle-opacity': 0.88,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'route-cluster-count',
        type: 'symbol',
        source: 'route-locations',
        filter: ['has', 'point_count'],
        maxzoom: 6,
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
        },
        paint: { 'text-color': '#171717' },
      });
    }
    if (
      fittedRef.current?.routes !== routes ||
      fittedRef.current?.view !== view
    ) {
      fittedRef.current = { routes, view };
      if (selectedActivity || view === 'world') fitRoutes();
      else focusRoutes();
    }
  }, [routes, routeStarts, selectedActivity, focusRoutes, fitRoutes, view]);

  // The WebGL map is owned by the renderer, not by the UI language.
  // Recreating it on every locale change discards loaded tiles and routes.
  useEffect(() => {
    if (!containerRef.current || !panelRef.current) return;
    // Mapbox and MapLibre implement the common Map/Control API used here.
    // Keep the structural type bridge at the integration boundary.
    const engine = useMapbox
      ? mapboxgl
      : (maplibregl as unknown as typeof mapboxgl);
    // Mapbox and MapLibre expose this setting at different levels. Setting
    // preserveDrawingBuffer only at the top level is silently ignored by
    // MapLibre 5, leaving its WebGL context in the default non-preserved mode.
    const bufferOptions = useMapbox
      ? { preserveDrawingBuffer: true }
      : { canvasContextAttributes: { preserveDrawingBuffer: true } };
    styleReadyRef.current = false;
    fittedRef.current = null;
    const map = new engine.Map({
      container: containerRef.current,
      accessToken: MAPBOX_TOKEN,
      ...bufferOptions,
      style: { version: 8, sources: {}, layers: [] },
      center: [121.4, 31.2],
      zoom: 10,
      ...cameraRef.current,
    });
    let observer: ResizeObserver | null = null;
    const resize = () => map.resize();
    try {
      mapRef.current = map;
      map.addControl(new engine.NavigationControl(), 'top-right');
      map.addControl(
        new engine.FullscreenControl({ container: panelRef.current }),
        'top-right'
      );
      map.addControl(
        new engine.ScaleControl({ unit: 'metric', maxWidth: 90 }),
        'bottom-left'
      );
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', resize);
      } else {
        observer = new ResizeObserver(resize);
        observer.observe(containerRef.current);
      }
    } catch (error) {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      map.remove();
      mapRef.current = null;
      throw error;
    }
    return () => {
      cameraRef.current = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      map.remove();
      mapRef.current = null;
    };
  }, [useMapbox]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Native map controls are outside React; update their accessible labels
    // without replacing the map, its style, or its WebGL canvas.
    const labels: [string, string][] = [
      ['zoom-in', zh ? '放大' : 'Zoom in'],
      ['zoom-out', zh ? '缩小' : 'Zoom out'],
      ['compass', zh ? '恢复朝北' : 'Reset bearing to north'],
      ['fullscreen', zh ? '全屏查看' : 'Enter fullscreen'],
      ['shrink', zh ? '退出全屏' : 'Exit fullscreen'],
    ];
    for (const [name, label] of labels) {
      const control = container.querySelector<HTMLButtonElement>(
        `.mapboxgl-ctrl-${name}, .maplibregl-ctrl-${name}`
      );
      if (control) {
        control.title = label;
        control.setAttribute('aria-label', label);
      }
    }
  }, [zh, useMapbox]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let active = true;
    const onStyleSetupError = () => {
      if (!active) return;
      if (provider === 'mapbox') setProvider('carto');
      else if (provider === 'carto') setProvider('plain');
      else setStatus('error');
    };
    const onError = (event: mapboxgl.ErrorEvent) => {
      const code = (event.error as (Error & { status?: number }) | undefined)
        ?.status;
      if (
        provider === 'mapbox' &&
        (!styleReadyRef.current || code === 401 || code === 403)
      ) {
        setStatus('loading');
        setProvider('carto');
      } else if (!styleReadyRef.current) {
        if (provider === 'carto') setProvider('plain');
        else setStatus('error');
      }
    };
    const onIdle = () => {
      if (styleReadyRef.current) setStatus('ready');
    };
    const onLoading = () => setStatus('loading');
    map.on('error', onError);
    map.on('idle', onIdle);
    map.once('styledataloading', onLoading);
    styleReadyRef.current = false;
    try {
      map.setStyle(style, {
        diff: false,
        localFontFamily: undefined,
        localIdeographFontFamily: 'sans-serif',
      });
    } catch {
      queueMicrotask(onStyleSetupError);
    }
    const timer = window.setTimeout(() => {
      if (!styleReadyRef.current) {
        if (provider === 'mapbox') setProvider('carto');
        else if (provider === 'carto') setProvider('plain');
        else setStatus('error');
      }
    }, 15000);
    return () => {
      active = false;
      window.clearTimeout(timer);
      map.off('error', onError);
      map.off('idle', onIdle);
      map.off('styledataloading', onLoading);
    };
  }, [style, provider, retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onStyleLoad = () => {
      try {
        styleReadyRef.current = true;
        drawRoutes();
      } catch {
        styleReadyRef.current = false;
        if (provider === 'mapbox') setProvider('carto');
        else if (provider === 'carto') setProvider('plain');
        else setStatus('error');
      }
    };
    map.on('style.load', onStyleLoad);
    drawRoutes();
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [drawRoutes, style, provider, retry]);

  useEffect(() => {
    let wasFullscreen = document.fullscreenElement === panelRef.current;
    let frame = 0;
    const onFullscreen = () => {
      const isFullscreen = document.fullscreenElement === panelRef.current;
      if (isFullscreen || wasFullscreen) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          mapRef.current?.resize();
          if (view === 'world' || selectedActivity) fitRoutes();
          else focusRoutes();
        });
      }
      wasFullscreen = isFullscreen;
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [fitRoutes, focusRoutes, view, selectedActivity]);

  return (
    <section
      ref={panelRef}
      className="route-map"
      aria-label={zh ? '路线地图' : 'Route map'}
    >
      <div className="route-map-header">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {zh ? '路线地图' : 'Route map'}
          </h2>
          <p
            className="truncate text-xs text-[var(--color-muted)]"
            title={selectedActivity?.name}
          >
            {selectedActivity
              ? `${selectedActivity.name} · ${(selectedActivity.distance / 1000).toFixed(1)} km`
              : `${routeStarts.length.toLocaleString()} ${zh ? (view === 'world' ? '条轨迹 · 全球足迹' : '条轨迹 · 区域视图') : view === 'world' ? 'routes · world overview' : 'routes · regional view'}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {selectedActivity && onClearSelection && (
            <button className="route-map-action" onClick={onClearSelection}>
              {zh ? '返回总览' : 'Overview'}
            </button>
          )}
          <button
            className="route-map-action"
            disabled={!routes.length}
            onClick={() => {
              if (selectedActivity) fitRoutes();
              else
                setPreferredView({
                  scope: activities,
                  view: view === 'world' ? 'region' : 'world',
                });
            }}
            title={
              view === 'world'
                ? zh
                  ? '聚焦最近活动所在区域'
                  : 'Focus the most recent running region'
                : zh
                  ? '将所有当前轨迹完整放入视野'
                  : 'Fit all current routes'
            }
          >
            {selectedActivity
              ? zh
                ? '定位轨迹'
                : 'Fit route'
              : view === 'world'
                ? zh
                  ? '区域视图'
                  : 'Region'
                : zh
                  ? '全球视图'
                  : 'World'}
          </button>
        </div>
      </div>
      {fallbackActivity && (
        <p
          role="status"
          className="px-4 pb-2 text-xs text-[var(--color-muted)]"
        >
          {zh
            ? `此活动没有可用的 GPS 轨迹，现显示之前最近一次有轨迹的活动：${fallbackActivity.name}（${fallbackActivity.start_date_local}）。`
            : `This activity has no usable GPS route. Showing the most recent earlier mapped activity: ${fallbackActivity.name} (${fallbackActivity.start_date_local}).`}
        </p>
      )}
      <div
        className={
          status === 'error' ? 'route-map-body hidden' : 'route-map-body'
        }
      >
        <div ref={containerRef} className="h-full w-full" />
        {!routes.length && (
          <div className="route-map-empty" role="status">
            {zh
              ? selectedActivity
                ? '这次活动没有 GPS 轨迹'
                : '当前筛选没有 GPS 轨迹'
              : 'No GPS route available'}
          </div>
        )}
      </div>
      {status === 'error' && (
        <RouteMapUnavailable
          activities={routeActivities}
          onSelectActivity={onSelectActivity}
          embedded
          onRetry={() => {
            setStatus('loading');
            setProvider(MAPBOX_TOKEN ? 'mapbox' : 'carto');
            setRetry((value) => value + 1);
          }}
        />
      )}
      <div className="route-map-footer">
        <span role="status" aria-live="polite">
          {status === 'error'
            ? zh
              ? '底图加载失败，请重试'
              : 'Basemap failed to load'
            : status === 'loading'
              ? zh
                ? '正在加载地图…'
                : 'Loading map…'
              : provider === 'plain'
                ? zh
                  ? '仅显示轨迹 · 底图不可用'
                  : 'Routes only · basemap unavailable'
                : provider === 'carto'
                  ? zh
                    ? '备用底图 · CARTO'
                    : 'Alternative basemap · CARTO'
                  : zh
                    ? '底图 · Mapbox'
                    : 'Basemap · Mapbox'}
        </span>
        {(status === 'error' || provider !== 'mapbox') && (
          <button
            className="route-map-action"
            onClick={() => {
              setProvider(MAPBOX_TOKEN ? 'mapbox' : 'carto');
              setRetry((value) => value + 1);
            }}
          >
            {provider === 'carto' && MAPBOX_TOKEN
              ? zh
                ? '重试 Mapbox'
                : 'Retry Mapbox'
              : zh
                ? '重试'
                : 'Retry'}
          </button>
        )}
      </div>
    </section>
  );
}

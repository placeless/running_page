import { memo, useEffect, useMemo, useState } from 'react';
import type { Activity } from '../types';
import { useLocale } from '../hooks/useLocale';
import { ChinaMap } from './ChinaMap';
import worldUrl from '../static/world.zh.json?url';

type CountryFeature = {
  type: 'Feature';
  properties: { iso_a2: string; name: string };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
};

const W = 360;
const H = 174;
const isoCountryCode = /^[A-Z]{2}$/;

function displayCountryName(
  displayNames: Intl.DisplayNames,
  code: string,
  fallback: string = code
) {
  // Natural Earth uses -99 for territories without an ISO country code.
  // Intl.DisplayNames.of('-99') throws a RangeError during rendering.
  if (!isoCountryCode.test(code)) return fallback;
  try {
    return displayNames.of(code) ?? fallback;
  } catch {
    return fallback;
  }
}

const project = ([lng, lat]: number[]) => [
  ((lng + 180) / 360) * W,
  ((85 - lat) / 170) * H,
];

function pathForFeature(feature: CountryFeature) {
  const rings =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as number[][][]]
      : (feature.geometry.coordinates as number[][][][]);
  return rings
    .flatMap((poly) =>
      poly.map(
        (ring) =>
          ring
            .map((point, i) => {
              const [x, y] = project(point);
              return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(' ') + 'Z'
      )
    )
    .join(' ');
}

interface Props {
  activities: Activity[];
  selectedCountry: string | null;
  selectedRegion: string | null;
  onSelectCountry: (country: string | null) => void;
  onSelectRegion: (region: string | null) => void;
}

export const FootprintMap = memo(function FootprintMap({
  activities,
  selectedCountry,
  selectedRegion,
  onSelectCountry,
  onSelectRegion,
}: Props) {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const [features, setFeatures] = useState<CountryFeature[]>([]);
  const [worldError, setWorldError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(worldUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Country boundaries: ${response.status}`);
        return response.json() as Promise<{ features: CountryFeature[] }>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setFeatures(data.features);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWorldError(true);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const activity of activities) {
      if (activity.country_code) {
        counts.set(
          activity.country_code,
          (counts.get(activity.country_code) ?? 0) + 1
        );
      }
    }
    return counts;
  }, [activities]);
  const unlocated =
    activities.length - [...countries.values()].reduce((a, b) => a + b, 0);

  const regions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const activity of activities) {
      if (
        activity.region &&
        (!selectedCountry || activity.country_code === selectedCountry)
      ) {
        const key = `${activity.country_code}:${activity.region}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [activities, selectedCountry]);

  const paths = useMemo(
    () =>
      features.map((feature) => ({
        code: feature.properties.iso_a2,
        name: feature.properties.name,
        path: pathForFeature(feature),
      })),
    [features]
  );
  const countryNames = useMemo(
    () => new Intl.DisplayNames([zh ? 'zh-CN' : 'en'], { type: 'region' }),
    [zh]
  );

  return (
    <section
      aria-label={zh ? '足迹地图' : 'Footprint map'}
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {zh ? '足迹地图' : 'Footprint map'}
        </h2>
        <span className="text-xs text-[var(--color-muted)]">
          {countries.size} {zh ? '个国家' : 'countries'}
        </span>
      </div>
      {selectedCountry === 'CN' ? (
        <>
          <button
            className="mb-2 text-xs text-[var(--color-accent)]"
            onClick={() => onSelectCountry(null)}
          >
            {zh ? '返回世界地图' : 'Back to world map'}
          </button>
          <ChinaMap
            embedded
            activities={activities.filter((a) => a.country_code === 'CN')}
            filter="all"
            selectedProvince={
              selectedRegion?.startsWith('CN:') ? selectedRegion.slice(3) : null
            }
            onSelectProvince={(region) =>
              onSelectRegion(region ? `CN:${region}` : null)
            }
          />
        </>
      ) : worldError ? (
        <p
          role="status"
          className="py-10 text-center text-xs text-[var(--color-muted)]"
        >
          {zh ? '世界地图边界加载失败' : 'Could not load world map boundaries'}
        </p>
      ) : paths.length === 0 ? (
        <p
          role="status"
          className="py-10 text-center text-xs text-[var(--color-muted)]"
        >
          {zh ? '正在加载世界地图…' : 'Loading world map…'}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label={zh ? '选择国家以筛选路线' : 'Filter routes by country'}
          className="block w-full"
        >
          {paths.map(({ code, name, path }) => {
            const visited = countries.has(code);
            const selected = selectedCountry === code;
            return (
              <path
                key={`${code}-${name}`}
                d={path}
                fill={
                  selected
                    ? 'var(--color-accent)'
                    : visited
                      ? 'color-mix(in srgb, var(--color-accent) 65%, transparent)'
                      : 'var(--color-border)'
                }
                fillRule="evenodd"
                stroke="var(--color-bg)"
                strokeWidth={0.45}
                className={visited ? 'cursor-pointer' : ''}
                role={visited ? 'button' : undefined}
                aria-hidden={!visited}
                tabIndex={visited ? 0 : undefined}
                aria-label={`${displayCountryName(countryNames, code, name)}: ${countries.get(code) ?? 0}`}
                aria-pressed={visited ? selected : undefined}
                onClick={() =>
                  visited && onSelectCountry(selected ? null : code)
                }
                onKeyDown={(event) => {
                  if (visited && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onSelectCountry(selected ? null : code);
                  }
                }}
              />
            );
          })}
        </svg>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[...countries]
          .sort((a, b) => b[1] - a[1])
          .map(([code, count]) => (
            <button
              key={code}
              aria-pressed={selectedCountry === code}
              onClick={() =>
                onSelectCountry(selectedCountry === code ? null : code)
              }
              className={`rounded border px-2 py-1 text-xs ${selectedCountry === code ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
            >
              {displayCountryName(countryNames, code)} · {count}
            </button>
          ))}
      </div>
      {regions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
          {regions.map(([key, count]) => (
            <button
              key={key}
              aria-pressed={selectedRegion === key}
              onClick={() =>
                onSelectRegion(selectedRegion === key ? null : key)
              }
              className={`rounded border px-2 py-1 text-xs ${selectedRegion === key ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
            >
              {key.slice(3)} · {count}
            </button>
          ))}
        </div>
      )}
      {unlocated > 0 && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          {zh
            ? `${unlocated} 次活动缺少可判定的地理信息，未计入统计`
            : `${unlocated} activities have no reliable location and are excluded`}
        </p>
      )}
    </section>
  );
});

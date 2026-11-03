import polyline from '@mapbox/polyline';

/** Only already-redacted public geometry should reach this module. */
export interface PublicRoute {
  summary_polyline?: string | null;
  route_segments?: string[];
}

export function decodedRouteSegments(route: PublicRoute): number[][][] {
  const encoded =
    route.route_segments ??
    (route.summary_polyline ? [route.summary_polyline] : []);
  return encoded.flatMap((segment) => {
    try {
      const points = polyline.decode(segment);
      return points.length >= 2 &&
        points.every(
          ([lat, lng]) =>
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lng) <= 180
        )
        ? [points]
        : [];
    } catch {
      // One corrupt segment must not hide another valid, redacted segment.
      return [];
    }
  });
}

/** Render separate SVG lines. Never bridge a protected gap. */
export function thumbnailPaths(route: PublicRoute, size = 80): string[] {
  const segments = decodedRouteSegments(route);
  const points = segments.flat();
  if (!points.length) return [];
  const latitudes = points.map(([lat]) => lat);
  const longitudes = points.map(([, lng]) => lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = Math.max(maxLat - minLat, 0.001);
  const lngSpan = Math.max(maxLng - minLng, 0.001);
  const scale = Math.min((size - 8) / lngSpan, (size - 8) / latSpan);
  const offsetX = (size - lngSpan * scale) / 2;
  const offsetY = (size - latSpan * scale) / 2;
  return segments.map((segment) =>
    segment
      .map(([lat, lng]) => {
        const x = (lng - minLng) * scale + offsetX;
        const y = size - ((lat - minLat) * scale + offsetY);
        return x.toFixed(1) + ',' + y.toFixed(1);
      })
      .join(' ')
  );
}

interface ClusterTrack extends PublicRoute {
  start_date_local: string;
  distance: number;
}

/** Distinguish routes by their interior geometry, not only start/end points. */
function geometrySignature(route: PublicRoute): string | null {
  const segments = decodedRouteSegments(route);
  if (!segments.length) return null;
  return segments
    .map((segment) =>
      Array.from({ length: 9 }, (_, index) => {
        const [lat, lng] =
          segment[Math.round(((segment.length - 1) * index) / 8)];
        // ~100 m grid, enough to distinguish distinct loops from same start.
        return Math.round(lat * 1000) + ':' + Math.round(lng * 1000);
      }).join(';')
    )
    .join('|');
}

/**
 * Fast, deliberately conservative grouping: all members remain addressable.
 * Runs with no valid route are excluded by the caller, never silently merged.
 */
export function groupSimilarTracks(
  tracks: readonly ClusterTrack[]
): number[][] {
  const groups = new Map<string, number[]>();
  const order = tracks
    .map((_, index) => index)
    .sort((a, b) =>
      tracks[b].start_date_local.localeCompare(tracks[a].start_date_local)
    );
  for (const index of order) {
    const track = tracks[index];
    const signature = geometrySignature(track);
    if (!signature) continue;
    const key = Math.round(track.distance / 500) + '|' + signature;
    const members = groups.get(key) ?? [];
    members.push(index);
    groups.set(key, members);
  }
  return [...groups.values()];
}

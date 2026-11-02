export type RoutePoint = readonly [longitude: number, latitude: number];

export type RouteView = 'world' | 'region';

const EARTH_RADIUS_KM = 6371;

/** Shortest great-circle distance, including routes across the antimeridian. */
export function routeDistanceKm(a: RoutePoint, b: RoutePoint): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (b[1] - a[1]) * radians;
  const longitudeDelta = (b[0] - a[0]) * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a[1] * radians) *
      Math.cos(b[1] * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/**
 * Prefer a worldwide overview when a meaningful share of activities is
 * genuinely far away, rather than letting a single holiday route dictate the
 * camera. When focusing locally, include neighboring running destinations.
 */
export function routeViewport(
  routeStarts: readonly RoutePoint[],
  recentStart: RoutePoint | null
): { initialView: RouteView; nearbyRouteIndices: number[] } {
  if (!recentStart || !routeStarts.length) {
    return {
      initialView: 'region',
      nearbyRouteIndices: routeStarts.map((_, index) => index),
    };
  }

  const nearbyRouteIndices: number[] = [];
  let distantRoutes = 0;
  for (const [index, point] of routeStarts.entries()) {
    const distance = routeDistanceKm(point, recentStart);
    if (distance <= 250) nearbyRouteIndices.push(index);
    if (distance >= 1200) distantRoutes++;
  }

  return {
    initialView:
      distantRoutes >= Math.max(3, Math.ceil(routeStarts.length * 0.05))
        ? 'world'
        : 'region',
    nearbyRouteIndices,
  };
}

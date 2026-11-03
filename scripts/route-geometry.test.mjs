import assert from 'node:assert/strict';
import { test } from 'node:test';
import polyline from '@mapbox/polyline';
import { createTypeScriptLoader } from './test-utils/load-typescript.mjs';

const loadSource = createTypeScriptLoader();
const { decodedRouteSegments, thumbnailPaths, groupSimilarTracks } = loadSource(
  'src/core/routeGeometry'
);
const { hasRoute, routeForActivity } = loadSource('src/core/routeFallback');

const loopA = polyline.encode([
  [43.0, -5.0],
  [43.012, -5.01],
  [43.014, -4.99],
  [43.0, -5.0],
]);
const loopB = polyline.encode([
  [43.0, -5.0],
  [42.988, -5.01],
  [42.986, -4.99],
  [43.0, -5.0],
]);
const privateSide = polyline.encode([
  [43.02, -5.02],
  [43.025, -5.025],
]);

function route(
  day,
  geometry = loopA,
  distance = 10000,
  routeSegments = undefined
) {
  return {
    start_date_local: day,
    distance,
    summary_polyline: geometry,
    route_segments: routeSegments,
  };
}

test('different loops sharing start/end/distance are never grouped', () => {
  const rows = [route('2026-11-02', loopA), route('2026-11-01', loopB)];
  assert.deepEqual(groupSimilarTracks(rows), [[0], [1]]);
});

test('similar geometry groups but returns every member in date order', () => {
  const rows = [
    route('2026-11-01', loopA),
    route('2026-11-03', loopA),
    route('2026-11-02', loopB),
  ];
  assert.deepEqual(groupSimilarTracks(rows), [[1, 0], [2]]);
  assert.deepEqual(groupSimilarTracks(rows).flat().sort(), [0, 1, 2]);
});

test('segmented routes render as independent lines, with protected gaps intact', () => {
  const segmented = route('2026-11-01', null, 6000, [loopA, privateSide]);
  assert.equal(hasRoute(segmented), true);
  assert.equal(decodedRouteSegments(segmented).length, 2);
  const paths = thumbnailPaths(segmented);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.split(' ').length >= 2));
  assert.deepEqual(groupSimilarTracks([segmented]), [[0]]);
});

test('one corrupt public segment does not hide the valid remainder', () => {
  const segmented = route('2026-11-01', null, 6000, ['_broken', privateSide]);
  assert.equal(hasRoute(segmented), true);
  assert.equal(thumbnailPaths(segmented).length, 1);
});

test('route_segments is authoritative, including explicit empty arrays', () => {
  const hidden = route('2026-11-02', loopA, 6000, []);
  assert.equal(hasRoute(hidden), false);
  assert.deepEqual(thumbnailPaths(hidden), []);
  assert.deepEqual(groupSimilarTracks([hidden]), []);
});

test('fallback returns only earlier, valid, redacted public route', () => {
  const selected = route('2026-11-03', null, 5000, []);
  const earlier = route('2026-11-02', null, 5000, [privateSide]);
  const later = route('2026-11-04', loopA);
  assert.equal(routeForActivity(selected, [later, selected, earlier]), earlier);
});

test('thumbnails and groups are deterministic across repeated calculations', () => {
  const rows = Array.from({ length: 120 }, (_, i) =>
    route(
      '2026-11-' + String(1 + (i % 3)).padStart(2, '0'),
      i % 2 ? loopA : loopB
    )
  );
  const first = groupSimilarTracks(rows);
  assert.deepEqual(first, groupSimilarTracks(rows));
  assert.equal(first.flat().length, rows.length);
  assert.equal(new Set(first.flat()).size, rows.length);
});

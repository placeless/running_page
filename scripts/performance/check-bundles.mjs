/**
 * Validate the route-less initial-load contract from the generated Vite
 * manifest, rather than asserting specific chunk filenames or sizes.
 *
 * Run after a production build: node scripts/performance/check-bundles.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(
  readFileSync(join('dist', '.vite', 'manifest.json'), 'utf8')
);

function staticImportsFrom(key, visited = new Set()) {
  if (visited.has(key)) return visited;
  assert.ok(manifest[key], 'Build manifest is missing ' + key);
  visited.add(key);
  for (const imported of manifest[key].imports ?? []) {
    staticImportsFrom(imported, visited);
  }
  return visited;
}

const modules = Object.keys(manifest);
const engines = modules.filter((key) =>
  /\/(mapbox-gl|maplibre-gl)\/dist\/\1\.js$/.test(key)
);
assert.equal(
  engines.length,
  2,
  'Expected both supported map engines in the build'
);

const routeCanvas = 'src/components/RouteMapCanvas.tsx';
const initial = staticImportsFrom('index.html');
const dashboard = staticImportsFrom('src/themes/dashboard/index.tsx');
const canvas = staticImportsFrom(routeCanvas);

for (const key of engines) {
  assert.ok(
    !initial.has(key),
    'Initial shell unexpectedly includes a WebGL engine'
  );
  assert.ok(!dashboard.has(key), 'Dashboard eagerly imports a WebGL engine');
  assert.ok(!canvas.has(key), 'Route canvas eagerly imports a WebGL engine');
  assert.ok(
    manifest[routeCanvas].dynamicImports?.includes(key),
    'Map engine is not loaded conditionally by the route canvas'
  );
}

console.log(
  'Verified: initial shell and Dashboard exclude both WebGL engines; ' +
    'route canvas imports only the selected renderer on demand.'
);

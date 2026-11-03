import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import polyline from '@mapbox/polyline';
import { createTypeScriptLoader } from './test-utils/load-typescript.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) =>
  readFileSync(path.join(root, relative), 'utf8');

function sampleActivity() {
  return {
    run_id: 1,
    type: 'Run',
    name: 'Run',
    start_date_local: '2026-11-01',
    distance: 5000,
    summary_polyline: polyline.encode([
      [43.3, -5.8],
      [43.4, -5.9],
    ]),
  };
}

test('shared activity loader retries after a failed request', async () => {
  const { getActivityData, resetActivityData } = createTypeScriptLoader({
    '@/static/activities.json?url': { default: '/synthetic-activities.json' },
  })('src/core/hooks/useActivities');
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  const sample = [sampleActivity()];
  try {
    globalThis.fetch = async () => {
      attempts++;
      return attempts === 1
        ? { ok: false, status: 503 }
        : { ok: true, json: async () => sample };
    };
    let firstPromise;
    try {
      getActivityData();
    } catch (thrown) {
      firstPromise = thrown;
    }
    await assert.rejects(firstPromise, /Failed to load activities: 503/);
    assert.throws(() => getActivityData(), /Failed to load activities: 503/);
    resetActivityData();
    let retryPromise;
    try {
      getActivityData();
    } catch (thrown) {
      retryPromise = thrown;
    }
    assert.deepEqual(await retryPromise, sample);
    assert.deepEqual(getActivityData(), sample);
    assert.equal(attempts, 2);
  } finally {
    resetActivityData();
    globalThis.fetch = originalFetch;
  }
});

test('classic uses the same resettable loader rather than a second fetch cache', () => {
  const classic = readSource('src/themes/classic/hooks/useActivities.ts');
  assert.match(classic, /getActivityData/);
  assert.doesNotMatch(classic, /fetch\(|activityDataPromise|activityDataError/);
  const boundary = readSource('src/components/ErrorBoundary.tsx');
  assert.match(boundary, /resetActivityData/);
});

test('map fallback preserves accessibility without WebGL', () => {
  const { RouteMapUnavailable } = createTypeScriptLoader({
    '../hooks/useLocale': { useLocale: () => ({ locale: 'en' }) },
  })('src/components/RouteMapUnavailable.tsx');
  const markup = renderToStaticMarkup(
    createElement(RouteMapUnavailable, {
      activities: [sampleActivity()],
      onSelectActivity: () => {},
      onRetry: () => {},
    })
  );
  assert.match(markup, /Map unavailable/);
  assert.match(markup, /Retry map/);
  assert.match(markup, /mapped activities/);
  assert.match(markup, /2026-11-01/);
  assert.match(markup, /<button/);
  assert.doesNotMatch(markup, /<canvas/);
});

test('locale allowlist ignores corrupt persisted values', () => {
  const { isLocale } = createTypeScriptLoader({
    '../config': { DEFAULT_LOCALE: 'en' },
  })('src/core/hooks/useLocale.tsx');
  assert.equal(isLocale('zh'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('de'), false);
  assert.equal(isLocale(''), false);
  assert.equal(isLocale(null), false);
  const html = readSource('index.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /document\.documentElement\.lang/);
});

test('selected orange filter uses a legible dark foreground', () => {
  const tracks = readSource('src/components/TracksPage.tsx');
  assert.match(tracks, /border-transparent text-\[#171717\]/);
  // #171717 on #f97316: measured WCAG contrast > 6.3:1.
  const luminance = (hex) => {
    const values = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      );
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const orange = luminance('#f97316');
  const foreground = luminance('#171717');
  assert.ok((orange + 0.05) / (foreground + 0.05) >= 4.5);
});

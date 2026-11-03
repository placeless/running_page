import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTypeScriptLoader } from './test-utils/load-typescript.mjs';

// Full fixture is invented and public-schema validated; no real run is read.
const safeActivities = JSON.parse(
  readFileSync('data/samples/activities.sample.json', 'utf8')
);
const { parseMovingTime } = createTypeScriptLoader()('src/core/domain/metrics');

const { ContributionHeatmap } = createTypeScriptLoader({
  '../hooks/useLocale': {
    useLocale: () => ({ locale: 'en', t: (key) => key }),
  },
  '../hooks/useActivities': {
    getAvailableYears: (activities) =>
      [
        ...new Set(
          activities.map((a) => Number(a.start_date_local.slice(0, 4)))
        ),
      ].sort((a, b) => b - a),
    formatDistance: (meters) => String(Math.round(meters / 1000)),
    parseMovingTime,
    formatPace: () => '5:00',
  },
  '../utils/exportCard': { exportCard: async () => 'not-used' },
})('src/components/ContributionHeatmap.tsx');

test('heatmap preserves all-sport, calendar-day and training-duration behavior', () => {
  const markup = renderToStaticMarkup(
    createElement(ContributionHeatmap, {
      activities: safeActivities,
      year: 2026,
      filter: 'all',
    })
  );
  assert.match(markup, /heatmap-day/);
  assert.match(markup, /2026-01-04: 45min/);
  assert.match(markup, /2026-03-29/);
  assert.match(markup, /2026-11-02/);
  assert.match(markup, /Training/);
  assert.match(markup, /sessions/);
  assert.doesNotMatch(markup, /Monthly Frequency/);
});

test('filtered run heatmap keeps its running pace and selected-year statistics', () => {
  const markup = renderToStaticMarkup(
    createElement(ContributionHeatmap, {
      activities: safeActivities.filter((a) => a.type === 'Run'),
      year: 2026,
      filter: 'Run',
    })
  );
  assert.match(markup, /Run Heatmap/);
  assert.match(markup, /5:00/);
  assert.doesNotMatch(markup, /Monthly Frequency/);
});

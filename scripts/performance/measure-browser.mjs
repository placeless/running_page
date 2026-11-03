/**
 * Optional local Firefox / WebDriver BiDi performance smoke test.
 *
 * Node >=22:
 *   node scripts/performance/measure-browser.mjs --out /tmp/running-perf.json
 *
 * Reads only the built dist/ and public JSON. The synthetic route dataset
 * is generated from scratch in memory and served on a loopback-only port.
 * Uses an isolated Firefox profile. Does not upload data or alter the build.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTCPServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import polyline from '@mapbox/polyline';

const options = process.argv.slice(2);
const option = (name, fallback) => {
  const index = options.indexOf(name);
  return index < 0 ? fallback : options[index + 1];
};
const dist = resolve(option('--dist', 'dist'));
const output = resolve(option('--out', join(tmpdir(), 'running-perf.json')));
const screenshot = option('--screenshot', null);
const executable = option(
  '--firefox',
  process.env.FIREFOX_BIN ??
    (process.platform === 'darwin'
      ? '/Applications/Firefox.app/Contents/MacOS/firefox'
      : 'firefox')
);
const datasetFilter = option('--dataset', 'both');
const pageFilter = option('--page', 'all');
const viewportFilter = option('--viewport', 'both');
const settleMs = Number(option('--settle-ms', '2300'));
const blockWebGL = options.includes('--block-webgl');
const scrollFootprint = options.includes('--scroll-footprint');
if (!['public', 'synthetic', 'both'].includes(datasetFilter))
  throw new Error('--dataset must be public, synthetic, or both');
if (!['all', '/', '/tracks', '/summary'].includes(pageFilter))
  throw new Error('--page must be all, /, /tracks, or /summary');
if (!['desktop', 'mobile', 'both'].includes(viewportFilter))
  throw new Error('--viewport must be desktop, mobile, or both');
if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 30000)
  throw new Error('--settle-ms must be between 0 and 30000');
const manifest = JSON.parse(
  readFileSync(join(dist, '.vite/manifest.json'), 'utf8')
);
const assetPath = '/' + manifest['src/static/activities.json'].file;
const publicCount = JSON.parse(
  readFileSync(join(dist, assetPath), 'utf8')
).length;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function fakeRoutes(count = 500) {
  return Array.from({ length: count }, (_, i) => {
    // Invented points. Never transform actual activity coordinates.
    const latitude = i % 9 === 0 ? -10 + (i % 7) * 7 : 18 + (i % 7) / 40;
    const longitude = i % 9 === 0 ? 90 + (i % 6) * 9 : 52 + (i % 7) / 40;
    const points = Array.from({ length: 30 }, (_, j) => [
      latitude + Math.sin((j / 29) * 6.28) * 0.013,
      longitude + Math.cos((j / 29) * 6.28) * 0.013,
    ]);
    const a = polyline.encode(points.slice(0, 15));
    const b = polyline.encode(points.slice(17));
    const date = new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10);
    return {
      run_id: i + 1,
      name: 'Run',
      type: 'Run',
      subtype: 'Run',
      distance: 10000,
      moving_time: '00:50:00',
      start_date_local: date,
      start_date: date,
      average_speed: 10000 / 3000,
      average_heartrate: 144,
      elevation_gain: 20,
      country_code: null,
      region: null,
      location_country: null,
      summary_polyline: a,
      route_segments: [a, b],
    };
  });
}
const syntheticData = JSON.stringify(fakeRoutes());
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
async function serve(synthetic) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = extname(url.pathname) ? url.pathname : '/index.html';
    const file = resolve(dist, '.' + path);
    if (!file.startsWith(dist + sep)) {
      res.writeHead(403).end();
      return;
    }
    let body;
    try {
      body =
        synthetic && path === assetPath ? syntheticData : readFileSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    if (path === '/index.html' && url.searchParams.get('theme') === 'light') {
      body = body
        .toString()
        .replace(
          '<head>',
          '<head><script>localStorage.setItem("theme","light")</script>'
        );
    }
    res
      .writeHead(200, {
        'content-type': types[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'public,max-age=120',
      })
      .end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: server.address().port };
}
async function choosePort() {
  const server = createTCPServer();
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => done(port));
    })
  );
}
function bidi(socket) {
  let nextID = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { done, fail, timeout } = pending.get(message.id);
    clearTimeout(timeout);
    pending.delete(message.id);
    if (message.type === 'error')
      fail(new Error(message.error + ': ' + message.message));
    else done(message.result);
  };
  return (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++nextID;
      const timeout = setTimeout(() => {
        pending.delete(id);
        fail(new Error('BiDi timed out: ' + method));
      }, 35000);
      pending.set(id, { done, fail, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
}

const metricsCode = [
  '(() => {',
  'const resources=performance.getEntriesByType("resource");',
  'const nav=performance.getEntriesByType("navigation")[0];',
  'const paint=performance.getEntriesByType("paint");',
  'const local=resources.filter(x=>new URL(x.name).origin===location.origin);',
  'const js=local.filter(x=>x.name.endsWith(".js"));',
  'const sum=(rows,key)=>rows.reduce((s,x)=>s+(x[key]||0),0);',
  'return JSON.stringify({',
  'path:location.pathname,',
  'loadMs:Math.round(nav.loadEventEnd),',
  'domReadyMs:Math.round(nav.domContentLoadedEventEnd),',
  'ttfbMs:Math.round(nav.responseStart),',
  'fcpMs:paint.find(x=>x.name==="first-contentful-paint")?.startTime??null,',
  'localRequests:local.length,',
  'localTransferBytes:sum(local,"transferSize"),',
  'localDecodedBytes:sum(local,"decodedBodySize"),',
  'jsRequests:js.length,',
  'jsTransferBytes:sum(js,"transferSize"),',
  'routeThumbs:document.querySelectorAll(".track-thumb").length,',
  'webglCanvas:!!document.querySelector(".mapboxgl-canvas,.maplibregl-canvas"),',
  'mapEngine:document.querySelector(".maplibregl-map")?"maplibre":document.querySelector(".mapboxgl-map")?"mapbox":null,',
  'mapStatus:document.querySelector(".route-map-footer [role=status]")?.textContent?.trim()??null,',
  'mapFallback:!!Array.from(document.querySelectorAll("h2")).find(x=>x.textContent?.includes("Map unavailable")),',
  'loadingMap:!!Array.from(document.querySelectorAll("[role=status]")).find(x=>x.textContent?.includes("Loading map")),',
  'footprintTop:Math.round(document.querySelector(\'section[aria-label="Footprint map"]\')?.getBoundingClientRect().top??-1),',
  'footprintPaths:document.querySelector(\'section[aria-label="Footprint map"] svg\')?.querySelectorAll("path").length??0,',
  'viewport:[innerWidth,innerHeight],',
  'heapBytes:performance.memory?.usedJSHeapSize??null,',
  'availableEntries:PerformanceObserver.supportedEntryTypes',
  '});})()',
].join('');

async function run() {
  if (!globalThis.WebSocket) throw new Error('Node 22+ WebSocket is required');
  const profile = mkdtempSync(join(tmpdir(), 'running-qa-firefox-'));
  const [publicHost, syntheticHost] = await Promise.all([
    serve(false),
    serve(true),
  ]);
  const debugPort = await choosePort();
  const child = spawn(
    executable,
    [
      '--headless',
      '--no-remote',
      '--profile',
      profile,
      '--remote-debugging-port',
      String(debugPort),
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let socket;
  try {
    for (let attempt = 0; attempt < 55 && !socket; attempt++) {
      try {
        const candidate = new WebSocket(
          'ws://127.0.0.1:' + debugPort + '/session'
        );
        await new Promise((done, fail) => {
          candidate.addEventListener('open', done, { once: true });
          candidate.addEventListener('error', fail, { once: true });
        });
        socket = candidate;
      } catch {
        await sleep(300);
      }
    }
    if (!socket) throw new Error('Isolated Firefox WebDriver BiDi unavailable');
    const send = bidi(socket);
    const session = await send('session.new', {
      capabilities: { alwaysMatch: { browserName: 'firefox' } },
    });
    const results = {
      browser:
        session.capabilities.browserName +
        ' ' +
        session.capabilities.browserVersion,
      publicActivities: publicCount,
      syntheticActivities: 500,
      cases: [],
    };
    for (const [dataset, host] of [
      ['public', publicHost],
      ['synthetic', syntheticHost],
    ]) {
      if (datasetFilter !== 'both' && datasetFilter !== dataset) continue;
      // Summary does not render routes; measuring it again with synthetic
      // inputs adds no map evidence and can overload a software renderer.
      for (const page of dataset === 'synthetic'
        ? ['/', '/tracks']
        : ['/', '/tracks', '/summary']) {
        if (pageFilter !== 'all' && pageFilter !== page) continue;
        for (const [width, height, theme] of [
          [1280, 900, 'dark'],
          [390, 844, 'light'],
        ]) {
          if (viewportFilter === 'desktop' && width !== 1280) continue;
          if (viewportFilter === 'mobile' && width !== 390) continue;
          const context = (
            await send('browsingContext.create', { type: 'tab' })
          ).context;
          if (blockWebGL) {
            await send('script.addPreloadScript', {
              contexts: [context],
              functionDeclaration: [
                '() => {',
                'const old=HTMLCanvasElement.prototype.getContext;',
                'HTMLCanvasElement.prototype.getContext=function(kind,...args){',
                'if(String(kind).includes("webgl"))return null;',
                'return old.call(this,kind,...args);',
                '};',
                '}',
              ].join(''),
            });
          }
          await send('browsingContext.setViewport', {
            context,
            viewport: { width, height },
          });
          const url =
            'http://127.0.0.1:' + host.port + page + '?theme=' + theme;
          await send('browsingContext.navigate', {
            context,
            url,
            wait: 'complete',
          });
          await send('script.evaluate', {
            expression: 'new Promise(r=>setTimeout(r,' + settleMs + '))',
            target: { context },
            awaitPromise: true,
          });
          const reading = await send('script.evaluate', {
            expression: metricsCode,
            target: { context },
            awaitPromise: true,
          });
          const row = JSON.parse(reading.result.value);
          // Firefox supports LCP via a buffered observer, not synchronous
          // getEntriesByType(). Never substitute FCP for an unavailable LCP.
          const lcp = await send('script.evaluate', {
            expression: [
              '(async()=>{',
              'if(!PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint"))return null;',
              'let last=null;',
              'const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())last=e.startTime;});',
              'observer.observe({type:"largest-contentful-paint",buffered:true});',
              'await new Promise(resolve=>setTimeout(resolve,100));',
              'observer.disconnect();return last;',
              '})()',
            ].join(''),
            target: { context },
            awaitPromise: true,
          });
          row.lcpMs = lcp.result.type === 'number' ? lcp.result.value : null;
          if (scrollFootprint && dataset === 'public' && page === '/') {
            await send('script.evaluate', {
              expression: [
                'document.querySelector(\'section[aria-label="Footprint map"]\')?.scrollIntoView({block:"center",behavior:"instant"});',
                'new Promise(resolve=>setTimeout(resolve,2000))',
              ].join(''),
              target: { context },
              awaitPromise: true,
            });
            const after = await send('script.evaluate', {
              expression: metricsCode,
              target: { context },
              awaitPromise: true,
            });
            const later = JSON.parse(after.result.value);
            row.afterScroll = {
              footprintTop: later.footprintTop,
              footprintPaths: later.footprintPaths,
              localRequests: later.localRequests,
              localTransferBytes: later.localTransferBytes,
            };
          }
          if (
            screenshot &&
            dataset === 'synthetic' &&
            page === '/' &&
            (width === 1280 || viewportFilter === 'mobile')
          ) {
            await send('script.evaluate', {
              expression: [
                'document.querySelector(".route-map")?.scrollIntoView({block:"center",behavior:"instant"});',
                'new Promise(resolve=>setTimeout(resolve,2400))',
              ].join(''),
              target: { context },
              awaitPromise: true,
            });
            const image = await send('browsingContext.captureScreenshot', {
              context,
            });
            writeFileSync(
              resolve(screenshot),
              Buffer.from(image.data, 'base64')
            );
          }
          results.cases.push({ dataset, page, theme, width, height, ...row });
          // Preserve completed cases if a later software-renderer test fails.
          writeFileSync(output, JSON.stringify(results, null, 2));
          console.log(
            dataset,
            page,
            width,
            theme,
            'FCP:',
            row.fcpMs,
            'JS:',
            Math.round(row.jsTransferBytes / 1024) + 'KB',
            'map:',
            row.webglCanvas,
            'fallback:',
            row.mapFallback,
            'thumbs:',
            row.routeThumbs
          );
          await send('browsingContext.close', { context });
        }
      }
    }
    writeFileSync(output, JSON.stringify(results, null, 2));
    console.log('Saved:', output);
  } finally {
    socket?.close();
    child.kill('SIGTERM');
    await Promise.all(
      [publicHost, syntheticHost].map(
        ({ server }) => new Promise((done) => server.close(done))
      )
    );
    rmSync(profile, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('Benchmark failed:', error.message);
  process.exitCode = 1;
});

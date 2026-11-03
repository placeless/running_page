// Prevent files containing original GPS or individually identifiable activity
// graphics from entering the public Git repository again.
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { readdirSync } from 'node:fs';
import process from 'node:process';

export const privatePaths = [
  /^run_page\/data\.db$/,
  /^(?:FIT_OUT|GPX_OUT|TCX_OUT|activities|private|\.private-running-data)\//,
  /^imported\.json$/,
  /^assets\/(?:grid|github[^/]*|mol[^/]*|year[^/]*)\.svg$/,
  /\.(?:fit|gpx|tcx|sqlite|sqlite3|db)$/i,
];

export function checkPublicRepository() {
  const paths = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const privateFiles = paths.filter((path) =>
    privatePaths.some((pattern) => pattern.test(path))
  );
  if (privateFiles.length) {
    throw new Error(
      `Public Git index still contains ${privateFiles.length} private files. ` +
        'Back them up, then use git rm --cached. Never publish this index.'
    );
  }

  // Vite's import.meta.glob also discovers ignored files in the working tree.
  // Such SVGs can enter dist/ even when Git correctly excludes them.
  const tracked = new Set(paths);
  const untrackedPrivateAssets = readdirSync('assets')
    .map((name) => `assets/${name}`)
    .filter(
      (path) =>
        !tracked.has(path) && privatePaths.some((pattern) => pattern.test(path))
    );
  if (untrackedPrivateAssets.length) {
    throw new Error(
      `Vite would bundle ${untrackedPrivateAssets.length} ignored private assets. ` +
        'Move them to an ignored private/ archive outside assets/ before building.'
    );
  }
  return paths.length;
}

if (process.argv[1]?.endsWith('check-public-repository.mjs')) {
  console.log(`Verified ${checkPublicRepository()} tracked public files`);
}

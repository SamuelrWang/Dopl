// F-111 residual (m), closed 2026-08-06 — EVERY SOURCE FILE IN THIS TREE IS CAPPED.
//
// The desktop takes NO §2 file-size exceptions, and `eslint.config.js` says so in its own
// header. That claim was false for one directory: `test/live/*.js` matched no block at all.
// The config's `.js` block is `main|scripts|renderer/**/*.js` and its test block is
// `test/**/*.mjs`, so the live contract tier — deliberately `.js` to keep it out of
// `node --test 'test/**/*.mjs'` — fell through both. 1681 lines with no `max-lines`, in the
// one tree whose whole point is that the cap has no exemptions.
//
// THIS TEST ASKS ESLINT, IT DOES NOT READ THE CONFIG'S TEXT. A shape assertion over the
// exported array would pass on a block that is present but does not actually match (a
// `test/live/*.js` glob does not match `test/live/checks/x.js`; a block placed after a more
// specific one can be overridden). `calculateConfigForFile` is the same resolution `npx
// eslint` performs, so what passes here is what the lint enforces — the distinction F-108
// is about.
//
// It covers the OTHER tiers too, deliberately. The gap was not "somebody forgot test/live";
// it was that nothing anywhere asserted the config's own stated invariant, so any future
// directory could repeat it silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every directory whose files are SOURCE this tree ships or runs. `renderer/app` is the
// BUILT SPA bundle and is ignored by the config on purpose (ENGINEERING §2), so it is not
// walked here either.
const SOURCE_DIRS = ['main', 'scripts', 'renderer', 'test'];
const IGNORED = new Set(['node_modules', 'dist', 'build', 'app']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((d) => {
  try {
    return walk(join(ROOT, d));
  } catch {
    return []; // a tier that does not exist is not a gap
  }
});

test('every source file in the desktop tree is covered by max-lines at 500', async () => {
  assert.ok(files.length > 100, 'the walk found nothing — the test would pass vacuously');

  const eslint = new ESLint({ cwd: ROOT });
  const uncapped = [];
  for (const file of files) {
    if (await eslint.isPathIgnored(file)) continue;
    const config = await eslint.calculateConfigForFile(file);
    const rule = config.rules && config.rules['max-lines'];
    // ['error'|2, { max: 500, ... }] — severity AND the number, because a block that
    // matched but set `warn` would leave the cap unenforced just as thoroughly.
    if (!rule || (rule[0] !== 2 && rule[0] !== 'error') || rule[1].max !== 500) {
      uncapped.push(relative(ROOT, file));
    }
  }

  assert.deepEqual(
    uncapped,
    [],
    `these files match no eslint block that caps them at 500:\n  ${uncapped.join('\n  ')}`
  );
});

test('the live contract tier specifically — the corner that had no cap', async () => {
  // Named separately from the sweep above so a regression reads as what it is rather than
  // as "some file somewhere". The `.js` extension here is load-bearing (it keeps the tier
  // out of `npm test`), so the fix can only ever be a config block, never a rename.
  const eslint = new ESLint({ cwd: ROOT });
  const config = await eslint.calculateConfigForFile(join(ROOT, 'test/live/run.js'));
  assert.deepEqual(config.rules['max-lines'], [
    2,
    { max: 500, skipBlankLines: false, skipComments: false },
  ]);
  assert.equal(config.languageOptions.sourceType, 'commonjs', 'the tier is CommonJS');
});

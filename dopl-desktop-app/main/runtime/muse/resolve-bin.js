// Which `muse` file every caller runs; resolves only, never spawns. Order is the kit's policy
// (`../kit/bin-resolve.js`): `DOPL_MUSE_BIN` > the Dopl-managed download from Meta's channel
// (`update-source.js`) > (no bundle — Meta's terms forbid redistribution, `packaging.js`) > PATH >
// well-known prefixes. Every candidate must pass the kit's `inspectCandidate`.
// This file keeps Muse's facts: the name, the override env, and the launcher mapping.

const fs = require('node:fs');
const path = require('node:path');
const binResolve = require('../kit/bin-resolve');

const BIN = 'muse';
const OVERRIDE_ENV = 'DOPL_MUSE_BIN';

// Meta's installer puts a BASH LAUNCHER at `<dir>/muse` (it self-updates in the background, then execs
// `<dir>/muse-bin-<version>` named by `<dir>/.muse-version`). Dopl runs the versioned binary directly: the
// launcher's own update would move the build under a running Dopl (MSP-REFERENCE §9).
const VERSION_FILE = '.muse-version';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,24})?$/;

function isScript(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(2);
    return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === '#!';
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

/** The versioned binary a launcher script at `resolved` would exec, or null. */
function launcherVendor(resolved) {
  if (path.basename(resolved) !== BIN || !isScript(resolved)) return null;
  let version = '';
  try { version = fs.readFileSync(path.join(path.dirname(resolved), VERSION_FILE), 'utf8').trim(); } catch (_) { return null; }
  if (!VERSION_RE.test(version)) return null;
  return path.join(path.dirname(resolved), `muse-bin-${version}`);
}

const resolver = binResolve.makeResolver({
  binName: BIN,
  overrideEnv: OVERRIDE_ENV,
  label: 'Muse',
  // Never bundled (Meta Model API terms §10.1(xiv): no redistribution of Downloadable Materials).
  bundledCandidate: () => null,
  launcherVendor,
  resolvePackage: require.resolve,
  // Lazy: `update-source.js` requires this module.
  downloaded: () => (require('../updates').activeFor(require('./update-source')) || {}).path || null,
});

/** The search, pure over `env` and `io` for tests. */
const resolveWith = (o) => resolver.resolveWith(o);

/** The resolved binary for this process (`resolveWith` shape). Only a HIT is cached. */
const resolveMuseBin = () => resolver.resolve();

/** Drop the cache (tests, explicit re-probe, an updater switch). */
const forget = () => resolver.forget();

const BIN_NAME = BIN;

module.exports = { resolveMuseBin, resolveWith, launcherVendor, forget, BIN_NAME, OVERRIDE_ENV, VERSION_FILE };

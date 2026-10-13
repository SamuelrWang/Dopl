// Which `grok` file every caller runs; resolves only, never spawns. Order is the kit's policy
// (`../kit/bin-resolve.js`): `DOPL_GROK_BIN` > the Dopl-managed download from xAI's stable channel
// (`update-source.js`) > (no bundle — 172 MB, xAI's own signed build, `packaging.js`) > PATH > well-known
// prefixes. Every candidate must pass the kit's `inspectCandidate`. xAI's installer drops the binary itself
// at `~/.local/bin/grok` (no launcher script), so there is no launcher mapping.

const binResolve = require('../kit/bin-resolve');

const BIN = 'grok';
const OVERRIDE_ENV = 'DOPL_GROK_BIN';

const resolver = binResolve.makeResolver({
  binName: BIN,
  overrideEnv: OVERRIDE_ENV,
  label: 'Grok',
  // Never bundled (`packaging.js`).
  bundledCandidate: () => null,
  resolvePackage: require.resolve,
  // Lazy: `update-source.js` requires this module.
  downloaded: () => (require('../updates').activeFor(require('./update-source')) || {}).path || null,
});

/** The search, pure over `env` and `io` for tests. */
const resolveWith = (o) => resolver.resolveWith(o);

/** The resolved binary for this process (`resolveWith` shape). Only a HIT is cached. */
const resolveGrokBin = () => resolver.resolve();

/** Drop the cache (tests, explicit re-probe, an updater switch). */
const forget = () => resolver.forget();

const BIN_NAME = BIN;

module.exports = { resolveGrokBin, resolveWith, forget, BIN_NAME, OVERRIDE_ENV };

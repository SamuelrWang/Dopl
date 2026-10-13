// Which `codex` file every caller runs; resolves only, never spawns. Order is policy: `DOPL_CODEX_BIN` >
// a verified download newer than the bundle (`update-source.js`) > bundled > PATH > well-known prefixes (a
// Finder-launched app gets launchd's bare PATH). Every candidate, the bundle included, must pass
// `inspectCandidate`. The search, the inspection and the hit cache are the kit's
// (`../kit/bin-resolve.js`, runtime scaffold K9, moved verbatim 2026-10-13); this file keeps Codex's
// facts: the name, the override env, the bundle's platform package and the npm launcher mapping.

const path = require('node:path');
const { rewriteAsarUnpacked } = require('../cli-spawn');
const binResolve = require('../kit/bin-resolve');

const BIN = 'codex';

// The operator's pick; outranks the bundle (support/dev lever) and is still validated.
const OVERRIDE_ENV = 'DOPL_CODEX_BIN';

// The `@openai/codex` launcher's triple map, so Dopl runs the vendor binary, not a Node launcher. Darwin
// only. Its `CODEX_MANAGED_PACKAGE_ROOT` is deliberately not set: Dopl's own updater moves the build.
const VENDOR_TRIPLE = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
};

// An alias dir: every platform package declares `"name": "@openai/codex"`, so that name finds the launcher.
const PLATFORM_PKG = (platform, arch) => `@openai/codex-${platform}-${arch}`;

// The bundled binary via the alias dir, `app.asar` → `app.asar.unpacked`; `null` is normal (the platform
// package is an optional dep gated on os/cpu). `resolvePackage` = `require.resolve`, injected for tests.
function bundledCandidate({ platform, arch, resolvePackage }) {
  const triple = VENDOR_TRIPLE[`${platform}-${arch}`];
  if (!triple || typeof resolvePackage !== 'function') return null;
  let pkgJson;
  try {
    pkgJson = resolvePackage(`${PLATFORM_PKG(platform, arch)}/package.json`);
  } catch (_) {
    return null;
  }
  if (typeof pkgJson !== 'string' || !pkgJson) return null;
  const root = path.dirname(rewriteAsarUnpacked(pkgJson));
  return path.join(root, 'vendor', triple, 'bin', BIN);
}

// An npm install's `codex` is `bin/codex.js`, a `#!/usr/bin/env node` launcher that dies under a Finder
// PATH (no `node`): return the vendor binary it would spawn, from that package's own deps, or `null` (CX-07).
function launcherVendor(resolved, { platform, arch, resolvePackage }) {
  if (typeof resolvePackage !== 'function' || path.basename(resolved) !== 'codex.js'
    || path.basename(path.dirname(resolved)) !== 'bin') return null;
  const pkgRoot = path.dirname(path.dirname(resolved));
  return bundledCandidate({ platform, arch, resolvePackage: (req) => resolvePackage(req, { paths: [pkgRoot] }) });
}

const resolver = binResolve.makeResolver({
  binName: BIN,
  overrideEnv: OVERRIDE_ENV,
  label: 'Codex',
  bundledCandidate,
  launcherVendor,
  // This module's own `require.resolve`: it shares the vendored binary's package tree, dev or packaged.
  resolvePackage: require.resolve,
  // Lazy: `update-source.js` requires this module.
  downloaded: () => (require('../updates').activeFor(require('./update-source')) || {}).path || null,
});

/** The search, pure over `env` and `io` for tests (`kit/bin-resolve.js` › makeResolver › resolveWith). */
const resolveWith = (o) => resolver.resolveWith(o);

// Only a HIT is cached; a miss re-walks, so a Codex installed while Dopl runs is found next probe (CX-08).
/** The resolved binary for this process (`resolveWith` shape). */
const resolveCodexBin = () => resolver.resolve();

/** Drop the cache (tests, explicit re-probe). */
const forget = () => resolver.forget();

// The bare name, for error messages only; never pass it to `spawn`.
const BIN_NAME = BIN;

module.exports = {
  resolveCodexBin,
  resolveWith,
  nodeNeighbours: binResolve.nodeNeighbours,
  bundledCandidate,
  rewriteAsarUnpacked,
  forget,
  BIN_NAME,
  OVERRIDE_ENV,
  VENDOR_TRIPLE,
};

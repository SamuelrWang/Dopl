// THE BINARY A CLAUDE LAUNCH RUNS — the bundled `claude` (asar-unpacked), or a verified download newer
// than it (`../updates/index.js`). Reached lazily by every caller (`loader.js`, `identity.js`,
// `models.js`, `shape.js`, `launch-spec.js`, core's `claude-auth.js`).
//
// ⚠ asar rewrite: the 256 MB `claude` Mach-O cannot exec from inside the read-only app.asar and
// codesign cannot sign a file inside it, so it is `asarUnpack`ed. require.resolve still reports
// the in-asar path. A dev/unpackaged tree has no `app.asar` segment and is unchanged.

const path = require('path');
const cliSpawn = require('../cli-spawn');
const { diag } = require('../../diag');
const updates = require('../updates');
const updateSource = require('./update-source');

const SDK_PKG = '@anthropic-ai/claude-agent-sdk';

// The bundled `claude` executable, `{ path, version }`, or null. The platform binary ships as
// `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` (an optionalDependency, host-arch only) with a
// `claude` file at its package root; `version` is that package's (the SDK's `exports` map hides its own).
function bundledClaude() {
  const platformPkg = `${SDK_PKG}-${process.platform}-${process.arch}`;
  try {
    const pkgJson = require.resolve(`${platformPkg}/package.json`);
    const bin = path.join(path.dirname(pkgJson), 'claude');
    return { path: cliSpawn.rewriteAsarUnpacked(bin), version: String(require(pkgJson).version || '?') };
  } catch (err) {
    diag('sdk-loader: platform binary unresolved', platformPkg, err && err.message);
    return null;
  }
}

// The binary a NEW launch runs, `{ path, version }`, or null (engine falls back to headless): a verified
// download newer than the bundle (`../updates/index.js`), else the bundle. A running session keeps the
// binary it was spawned from.
function claudeRuntime() {
  return updates.activeFor(updateSource) || bundledClaude();
}

// Absolute path for options.pathToClaudeCodeExecutable, or null.
function resolveClaudeExecutable() {
  const runtime = claudeRuntime();
  return runtime ? runtime.path : null;
}

module.exports = { SDK_PKG, bundledClaude, claudeRuntime, resolveClaudeExecutable };

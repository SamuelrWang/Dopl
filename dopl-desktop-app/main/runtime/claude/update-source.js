// How the shared runtime updater (`../updates/index.js`) keeps this runtime's CLI current: the platform
// binary package the SDK itself depends on, published per release under `latest`. Electron-free at load.
//
// ⚠ COMPATIBILITY = THE CANDIDATE'S OWN DESCRIPTION OF ITSELF (2026-10-08), never a version range. The
// shared updater (`updates/index.js › shapeGate`) runs `probeShape` on the downloaded binary — the bundled
// SDK JS driving the CANDIDATE CLI, turn-free (`roster.js › observeShape`) — and checks it against this
// adapter's `requiredShape`. A build that then fails its first handshake is rejected back to the last good one.
// The `major.minor` lockstep rule this replaced (`compatible`) is deleted: it guessed at the protocol.

const path = require('path');

const PKG = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;

module.exports = {
  id: 'claude',
  pkg: process.platform === 'darwin' ? PKG : null,
  tag: 'latest',
  versionOf: (v) => v,
  bundledVersion: () => {
    const bundled = require('./loader').bundledClaude();
    return bundled ? bundled.version : null;
  },
  binary: (root) => path.join(root, 'claude'),
  // Anthropic PBC's Developer ID team (`codesign -dv` on the vendor's own build).
  teamId: 'Q6L2SF6YDW',
  /** The candidate CLI as it describes itself, driven by the bundled SDK (lazy: electron-free at load). */
  probeShape: async (bin) => {
    const loader = require('./loader');
    const sdk = await loader.getSdk();
    const env = require('./credential').withCredential(loader.buildScrubbedEnv());
    return require('./roster').observeShape({ sdk, options: { env, pathToClaudeCodeExecutable: bin } });
  },
  /** The candidate's safety SEMANTICS, live (`semantics.js`: two short turns; runs only on a new build). */
  verifySemantics: async (bin) => {
    const loader = require('./loader');
    const sdk = await loader.getSdk();
    const env = require('./credential').withCredential(loader.buildScrubbedEnv());
    return require('./semantics').verifySemantics({ sdk, options: { env, pathToClaudeCodeExecutable: bin } });
  },
};

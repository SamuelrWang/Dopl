// How the shared runtime updater (`../updates/index.js`) keeps this runtime's CLI current: the platform
// binary package the SDK itself depends on, published per release under `latest`. Electron-free at load.
//
// ⚠ COMPATIBILITY = THE SAME `major.minor` AS THE BUNDLE. The SDK JS that drives the binary is always the
// bundled one, and the vendor ships SDK and CLI in lockstep as one `0.<minor>.<patch>` line: patches are
// the CLI's own releases (new models among them) behind the same stream-json control protocol, and a
// minor bump is where a 0.x package may break it. So a newer patch is adopted; a newer minor waits for a
// Dopl release that bumps the SDK. A patch that still fails its first handshake (`models.js › probeRows`,
// a turn-free `initialize`) is rejected back to the last good build.

const path = require('path');

const PKG = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;

const minorLine = (v) => String(v || '').split('.').slice(0, 2).join('.');

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
  compatible: (candidate, bundled) => !!bundled && minorLine(candidate) === minorLine(bundled),
};

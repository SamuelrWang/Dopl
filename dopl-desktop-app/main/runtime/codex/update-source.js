// How the shared runtime updater (`../updates/index.js`) keeps this runtime's CLI current: the vendor
// publishes each platform build of `@openai/codex` as its own version (`0.159.3-darwin-arm64`) under a
// dist-tag named for the platform. Electron-free at load.
//
// ⚠ COMPATIBILITY = THE PROTOCOL FLOOR, the policy this adapter already applies to any `codex` it runs
// (`protocol.js › SUPPORTED_CLI`: "a newer CLI is not refused"). A build that then fails its first
// handshake (`models.js`, `initialize` + `model/list`) is rejected back to the last good build.

const path = require('path');
const protocol = require('./protocol');
const resolveBin = require('./resolve-bin');

const PLATFORM = `${process.platform}-${process.arch}`;
const TRIPLE = resolveBin.VENDOR_TRIPLE[PLATFORM];

// `0.159.3-darwin-arm64` → `0.159.3`.
const versionOf = (v) => String(v || '').replace(`-${PLATFORM}`, '');

module.exports = {
  id: 'codex',
  pkg: process.platform === 'darwin' && TRIPLE ? '@openai/codex' : null,
  tag: PLATFORM,
  versionOf,
  bundledVersion: () => {
    try {
      return versionOf(require(`@openai/codex-${PLATFORM}/package.json`).version);
    } catch (_) {
      return null;
    }
  },
  // The whole package, not just the binary: the CLI finds `rg`, `zsh` and its voice host beside itself.
  binary: (root) => path.join(root, 'vendor', TRIPLE, 'bin', resolveBin.BIN_NAME),
  // OpenAI OpCo's Developer ID team (`codesign -dv` on the vendor's own build).
  teamId: '2DC432GLL2',
  compatible: (candidate) => protocol.versionGate(candidate).ok,
  // `resolve-bin.js` caches its hit for the process; a switch must re-resolve.
  onSwitch: () => resolveBin.forget(),
};

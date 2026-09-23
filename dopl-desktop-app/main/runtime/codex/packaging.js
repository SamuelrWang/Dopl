// How the Codex binary reaches an operator: bundled (`@openai/codex*`, Apache-2.0), re-signed with the app.
// `resolve-bin.js` still falls back to PATH when the optional platform package is absent. Size cost: F-192.

const packaging = {
  delivery: 'bundled',
  // Verbatim from `package.json › build.asarUnpack` (test-pinned). The whole platform package, not `bin/`:
  // the CLI finds `rg`, `zsh` and its voice host relative to itself. The launcher is never exec'd.
  unpackGlobs: [
    '**/@openai/codex-*/**',
    '**/@openai/codex/**',
  ],
  // Re-signed and notarised under Dopl's identity; `entitlementsInherit` carries JIT to nested binaries.
  signing: 'inherits-app-identity',
  // = `protocol.js › SUPPORTED_CLI.measuredFrom` = the exact `package.json` dependency, no caret (test-pinned).
  // `versionGate` still gates a `DOPL_CODEX_BIN` override at `client.js › probe`.
  versionPin: '@openai/codex@0.155.1',
};

module.exports = { packaging };

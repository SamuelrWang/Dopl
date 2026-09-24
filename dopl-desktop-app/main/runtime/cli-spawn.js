// Electron-free helpers every adapter's CLI spawn shares.

/** `…/app.asar/…` → `…/app.asar.unpacked/…`: a packaged binary can only be spawned from the unpacked tree. */
function rewriteAsarUnpacked(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

// Every model-vendor credential the bundled CLIs read from their environment (claude 2.1.220, codex-cli
// 0.155.1). An inherited one never reaches a child: each adapter sets only Dopl's own.
const INHERITED_CREDENTIAL_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
]);

/**
 * A copy of `env` for a runtime child: minus every inherited vendor credential and, when given, minus one
 * runtime's permission-affecting knobs (keys matching BOTH its vendor prefix and its knob pattern).
 */
function scrubbedEnv(env, prefixRe, knobRe) {
  const src = env || {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (INHERITED_CREDENTIAL_ENV.has(k) || (prefixRe && prefixRe.test(k) && knobRe.test(k))) continue;
    out[k] = src[k];
  }
  return out;
}

module.exports = { rewriteAsarUnpacked, scrubbedEnv, INHERITED_CREDENTIAL_ENV };

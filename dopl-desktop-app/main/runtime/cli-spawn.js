// Electron-free helpers every adapter's CLI spawn shares.

/** `…/app.asar/…` → `…/app.asar.unpacked/…`: a packaged binary can only be spawned from the unpacked tree. */
function rewriteAsarUnpacked(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

/**
 * A copy of `env` minus one runtime's permission-affecting knobs: keys matching BOTH its vendor
 * prefix and its knob pattern. It only removes; PATH, HOME and credentials always pass.
 */
function scrubPermissionEnv(env, prefixRe, knobRe) {
  const src = env || {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (prefixRe.test(k) && knobRe.test(k)) continue;
    out[k] = src[k];
  }
  return out;
}

module.exports = { rewriteAsarUnpacked, scrubPermissionEnv };

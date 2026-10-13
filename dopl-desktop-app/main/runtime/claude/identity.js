// THE BUILD NEW CLAUDE LAUNCHES RUN — `{ path, version, account }` for core's key (`../roster-key.js`):
// the ACTIVE binary (a verified download, else the bundle), its version, and whose roster it is.
// Electron-free at load: the resolver and the credential are reached lazily (`defaultDeps`).

// Injectable for the suite.
function defaultDeps() {
  return {
    bin: () => require('./resolve-bin').resolveClaudeExecutable(),
    // The ACTIVE binary's version (a verified download or the bundle), so a switch moves the key.
    sdkVersion: () => {
      try { return String((require('./resolve-bin').claudeRuntime() || {}).version || '?'); } catch (_) { return '?'; }
    },
    // Whose roster this is (cross-review M2): a one-way per-sign-in fingerprint, never the token or its source.
    account: () => require('./credential').accountFingerprint(),
  };
}
let deps = defaultDeps();

/** The build new launches run, for core's key (`roster-key.js`): binary, SDK version, account. */
function buildIdentity() {
  let bin = null;
  try { bin = deps.bin() || null; } catch (_) { bin = null; }
  let version = null;
  try { version = deps.sdkVersion() || null; } catch (_) { version = null; }
  // ⚠ NOT the credential source (a word like "dopl-token", the same for every account): with no fingerprint
  // the persisted roster is a labels-only stand-in (`model-catalog.js › persistedCatalog`).
  let account = null;
  try { account = deps.account() || null; } catch (_) { account = null; }
  return { path: bin, version, account };
}

/** `inject` swaps the dependencies (tests). */
function inject(overrides) { deps = Object.assign(defaultDeps(), overrides || {}); }

module.exports = { buildIdentity, inject };

// THE DEVICE-TOKEN CACHE — the one electron-store handle, the two keys it writes under, and the
// in-memory mint notifier. Nothing here decides anything: the LIFECYCLE (the mint, its sign-in
// gate, the revoke, the sign-out teardown and the memoized bearer the session path reads) is
// `mcp-device-token-lifecycle.js`, re-exported by `mcp-config.js`.
//
// SPLIT NOTE: extracted from mcp-config.js at the 500-line cap (2026-10-11, f96e7f07); the
// lifecycle followed in cleanup D04 the same night, with its tests moved from source slices to
// the real modules (`test/_device-token-harness.mjs`).
//
// ⚠ ONE INSTANCE, WHICH IS THE WHOLE POINT OF THE SPLIT. The lifecycle and `mcp-config.js` take
// these names back by destructuring this module — the `auth.js` ← `auth-store.js` pattern — so the
// handle `clearDeviceToken` deletes keys through and the Set the mint notifies are the objects
// declared HERE. A second `new Store()` would be a second cache under the same two keys; a copied
// `mintListeners` would be a listener that never fires, because `device-registry.js` registers
// through `onDeviceTokenMinted` while the mint calls `notifyMinted`.
//
// ⚠ The token value NEVER hits logs/diag, and never a file this app writes: safeStorage-encrypted
// under DT_KEY when the keychain is available, and DT_KEY_PLAIN only when it is not. Every write
// keeps the two mutually exclusive, so a keychain that comes back does not leave a cleartext copy.

const { safeStorage } = require('electron');
const Store = require('electron-store');

const store = new Store();
const DT_KEY = 'mcpDeviceToken'; // safeStorage-encrypted base64(JSON{token,expiresAt,label,tokenId?})
const DT_KEY_PLAIN = 'mcpDeviceTokenPlain';
const REUSE_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // re-mint when <7d remain

// ── Device-token cache (safeStorage) ─────────────────────────────────────────
// ⚠ THE IN-MEMORY COPY IS NOT SET HERE. `mcp-device-token-lifecycle.js › obtainDeviceToken` is this function's one
// caller and it refreshes `spawnToken` at the call site, ahead of the write — that memo is what
// `buildMcpServers` injects, so it belongs to the module whose accessor reads it.
function saveDeviceToken(obj) {
  try {
    const json = JSON.stringify(obj);
    if (safeStorage.isEncryptionAvailable()) {
      store.set(DT_KEY, safeStorage.encryptString(json).toString('base64'));
      store.delete(DT_KEY_PLAIN);
    } else {
      store.set(DT_KEY_PLAIN, json);
      store.delete(DT_KEY);
    }
  } catch (_) {
    /* best-effort cache */
  }
}

function loadDeviceToken() {
  try {
    const enc = store.get(DT_KEY);
    if (enc && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')));
    }
    const plain = store.get(DT_KEY_PLAIN);
    if (plain) return JSON.parse(plain);
  } catch (_) {
    /* fall through */
  }
  return null;
}

// In-memory mint notifier so the heartbeat learns a re-mint's id without re-reading the store.
const mintListeners = new Set();
function onDeviceTokenMinted(cb) {
  if (typeof cb !== 'function') return () => {};
  mintListeners.add(cb);
  return () => mintListeners.delete(cb);
}
function notifyMinted(link) {
  for (const cb of mintListeners) {
    try { cb(link); } catch (_) { /* a listener never breaks minting */ }
  }
}

module.exports = {
  store, // ⚠ THE handle, never a copy: `mcp-device-token-lifecycle.js › clearDeviceToken` deletes both keys through it
  DT_KEY,
  DT_KEY_PLAIN,
  REUSE_MARGIN_MS,
  saveDeviceToken,
  loadDeviceToken,
  onDeviceTokenMinted, // device-registry.js › arm, re-exported by mcp-config.js under this name
  notifyMinted,
};

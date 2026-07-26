// Storage for a Claude CLI long-lived OAuth token (from `claude setup-token`).
//
// EMPIRICAL NOTE (2026-07-25, claude 2.1.220): `claude setup-token` drives an
// OAuth flow (scope user:inference) and, on completion, may EITHER store the
// credential in claude's own store (then spawns work with no env) OR print a
// long-lived token string. This module only holds the printed-token case: when
// setup-token prints a token, we encrypt it here and the spawner injects it as
// CLAUDE_CODE_OAUTH_TOKEN. When setup-token stored internally, nothing is saved
// here and spawns rely on claude's own credentials — both paths are handled.
//
// No UI / electron-heavy deps here so the spawner can import it without cycles.
// The token NEVER goes to logs/diag.

const { safeStorage } = require('electron');
const Store = require('electron-store');

const store = new Store();
const KEY = 'claudeOAuthToken'; // safeStorage-encrypted base64
const KEY_PLAIN = 'claudeOAuthTokenPlain'; // fallback when no OS keychain

function setStoredOAuthToken(token) {
  if (!token || typeof token !== 'string') return false;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      store.set(KEY, safeStorage.encryptString(token).toString('base64'));
      store.delete(KEY_PLAIN);
    } else {
      // Unusual on macOS. Confined to this user's app-support dir.
      store.set(KEY_PLAIN, token);
      store.delete(KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function getStoredOAuthToken() {
  try {
    const enc = store.get(KEY);
    if (enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, 'base64')) || null;
    }
    const plain = store.get(KEY_PLAIN);
    if (plain) return String(plain);
  } catch (_) {
    /* fall through */
  }
  return null;
}

function clearStoredOAuthToken() {
  store.delete(KEY);
  store.delete(KEY_PLAIN);
}

module.exports = { setStoredOAuthToken, getStoredOAuthToken, clearStoredOAuthToken };

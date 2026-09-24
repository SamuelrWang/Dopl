// Dopl's own Claude Code credential: the long-lived OAuth token `claude setup-token` prints to Dopl's sign-in
// (`claude-auth.js`), safeStorage-encrypted. Its one writer is that flow, so it never holds a login the operator
// made outside Dopl. No UI deps, so the adapter can import it without cycles. The token never reaches a log.

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

// A Dopl sign-out drops our COPY; the token itself stays valid at Anthropic. True when nothing usable is left.
function clearStoredOAuthToken() {
  try {
    store.delete(KEY);
    store.delete(KEY_PLAIN);
  } catch (_) {
    return false;
  }
  return !getStoredOAuthToken();
}

module.exports = { setStoredOAuthToken, getStoredOAuthToken, clearStoredOAuthToken };

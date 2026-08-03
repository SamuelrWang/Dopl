// Encrypted session-blob persistence + the offline JWT helpers.
//
// SPLIT NOTE (Q4): extracted from auth.js so auth.js and auth-state.js can BOTH
// read/write the stored session without either requiring the other (no cycle).
// This is the lowest layer: safeStorage encryption, the electron-store keys, and
// the two JWT decoders. It knows nothing about cookies, sign-in policy, or HTTP.

const { safeStorage } = require('electron');
const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();
const STORE_KEY = 'authSession'; // safeStorage-encrypted blob
const PLAIN_KEY = STORE_KEY + 'Plain';

// ── Failure reporting (Q4 fix 3) ───────────────────────────────────────────
// Console output is invisible for a GUI-launched app, so every blob load /
// decrypt / persist / refresh failure used to be a silent death: the listener,
// presence, the consent watcher and mcp-config all went dark with nothing in
// listener.log to say why. Route them into the shared diag file log. THROTTLED
// per message — isSignedIn() runs on every watcher tick, and an undecryptable
// blob must not turn that into a log storm. Never pass a token here.
const FAIL_LOG_COOLDOWN_MS = 60_000;
const lastFailAt = new Map();
function authFail(what, err) {
  const detail = (err && err.message) || (err == null ? '' : String(err));
  const now = Date.now();
  if (now - (lastFailAt.get(what) || 0) < FAIL_LOG_COOLDOWN_MS) return;
  lastFailAt.set(what, now);
  console.error(`[auth] ${what}:`, detail);
  diag('auth:', what, '—', detail);
}

// TRUE only when the session actually reached disk. The outcome is REPORTED
// rather than swallowed: captureFromFragment used to answer "adopted" after a
// refusal below, so on a machine with no keychain sign-in returned {ok:true},
// the very next session load answered null, and the login screen re-rendered
// with neither an error nor progress — an unbreakable retry loop.
function persist(sessionObj) {
  try {
    const json = JSON.stringify(sessionObj);
    if (safeStorage.isEncryptionAvailable()) {
      store.set(STORE_KEY, safeStorage.encryptString(json).toString('base64'));
      store.delete(PLAIN_KEY);
      return true;
    } else {
      // No OS keychain (unusual on macOS). This USED TO fall back to plaintext,
      // "still confined to this user's app-support dir" — but what it writes is a
      // Supabase REFRESH TOKEN, i.e. a renewable credential for the account, into a
      // world-of-this-user-readable JSON file that also lands in Time Machine and any
      // folder sync. A broken keychain is not a reason to downgrade a credential to
      // cleartext. REFUSE and log (throttled to once a minute by authFail).
      //
      // The app stays usable: since Q4, being signed in no longer depends on this blob
      // (auth-state.js — a live cookie session counts), so the session simply lives in
      // the cookie jar for this run and the blob is repaired the moment safeStorage
      // works again. Any plaintext blob an older build left behind is deleted here.
      authFail('safeStorage unavailable — refusing to store the session unencrypted', null);
      store.delete(PLAIN_KEY);
      store.delete(STORE_KEY);
      return false;
    }
  } catch (err) {
    authFail('persist failed', err);
    return false;
  }
}

function loadSession() {
  try {
    const enc = store.get(STORE_KEY);
    if (enc && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64')));
    }
    const plain = store.get(PLAIN_KEY);
    if (plain) return JSON.parse(plain);
  } catch (err) {
    authFail('session blob load/decrypt failed', err);
  }
  return null;
}

function clearSession() {
  store.delete(STORE_KEY);
  store.delete(PLAIN_KEY);
}

// ── JWT helpers (offline) ──────────────────────────────────────────────────
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

// The `exp` claim (unix seconds) of a JWT, or null when it cannot be read (e.g. a
// Dopl `dopl_at_` device token, which is not a JWT at all).
function jwtExp(token) {
  const claims = token ? decodeJwt(token) : null;
  const exp = claims && claims.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

module.exports = { store, authFail, persist, loadSession, clearSession, decodeJwt, jwtExp };

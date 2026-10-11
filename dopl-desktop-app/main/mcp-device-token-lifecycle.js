// THE DEVICE-TOKEN LIFECYCLE — the mint, its sign-in gate, the revoke, the sign-out teardown and the
// memoized bearer the session path reads. The STORE (electron-store handle, keys, mint notifier)
// is `mcp-device-token.js`; the operator's own CLI entry is `mcp-config.js`, which re-exports
// every name below so no caller's require moves.
//
// SPLIT NOTE (2026-10-11, cleanup D04): extracted from mcp-config.js at the 500-line cap. The
// suites that used to slice these bodies out of mcp-config.js by name now load this whole file
// over a stub map (`test/helpers/module-sandbox.mjs › loadWithStubs`) and drive the real exports.
//
// ⚠ The token value NEVER hits logs/diag, and never a file this app writes: it lives
// safeStorage-encrypted in the store, in memory here, and in a CLI argv (mcp-cli-add.js).

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const auth = require('./auth');
const { apiFetch } = require('./api');
const { diag } = require('./diag');
const { withDeadline, DEADLINE } = require('./deadline');
const { MCP_DEVICE_TOKEN_PATH } = require('./config');
const { isUuid } = require('./ipc-guards');
// ⚠ ONE INSTANCE, read never restated: the store handle, its two keys and the mint-listener Set live in that module.
const { store, DT_KEY, DT_KEY_PLAIN, REUSE_MARGIN_MS, saveDeviceToken, loadDeviceToken, notifyMinted } = require('./mcp-device-token');

// ⚠ Sign-out is a CLICK: the server revoke is best-effort and must never hold it. Offline,
// captive-portal and 5xx all fall through to local teardown.
const REVOKE_TIMEOUT_MS = 3_000;

// The label this machine mints under. The server keys revoke-and-replace on (user, label), so
// the hostname keeps two Macs from churning each other's tokens. ⚠ ONE definition — mint and
// revoke must agree, or a drifted label revokes nothing and leaves the live token behind.
function deviceLabel() {
  try {
    return `Dopl Desktop CLI (${require('os').hostname()})`;
  } catch (_) {
    return 'Dopl Desktop CLI';
  }
}

// Bound a promise that may not settle. apiFetch's AbortController covers the fetch, but
// getAuthCookie() ahead of it can await a token refresh, so the whole call needs an outer stop.
// null on timeout; the loser settles on its own (its rejection is handled by the race).
// The body is `deadline.js` (F-700), not a second copy; only the sentinel is translated here.
function withTimeout(promise, ms) {
  return withDeadline(promise, ms).then((v) => (v === DEADLINE ? null : v));
}

// ⚠ NOTHING WRITES THIS FILE ANY MORE (2026-08-26). The path stays because `clearDeviceToken`
// still rm's it at sign-out — the belt for a machine that signs out before its next signed-in
// launch runs `mcp-config.js › removeSpawnConfig`.
function spawnConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-spawn.json');
}

// How the device heartbeat links the CURRENT token to this computer: its row id, or (records
// minted before the server returned one) the label. Read once per arm/sign-in, never per beat.
function deviceTokenLink() {
  const rec = loadDeviceToken();
  if (!rec || !rec.token) return null;
  if (isUuid(rec.tokenId)) return { tokenId: rec.tokenId };
  return { tokenLabel: String(rec.label || deviceLabel()) };
}

// ⚠ THE SDK PATH'S BEARER, never a file read. Every profile PRE-APPROVES `Read` and `Bash`
// reaches a rule layer that cannot express a path, so the bearer must not sit in plaintext under
// userData. This reads the safeStorage cache instead: decrypted on demand, memoized for the
// process life, never logged. '' when nothing usable (pre-sign-in), which hands the session an
// empty mcpServers object.
let spawnToken = '';
function deviceTokenForSpawn() {
  if (spawnToken) return spawnToken;
  const rec = loadDeviceToken();
  const token = rec && rec.token ? String(rec.token) : '';
  if (token) spawnToken = token;
  return token;
}

// ⚠ SIGN-OUT TEARDOWN FOR THE MCP CREDENTIAL — LOCAL HALF ONLY. Without it, sign-out leaves a
// 90-day dopl.read+dopl.write device token live in electron-store (DT_KEY / DT_KEY_PLAIN) for
// anything that can read the app's data dir, the next operator on this machine included.
// ⚠ PAIR WITH revokeDeviceToken() below, which kills the token SERVER-side: deleting our copies
// does not invalidate the credential. signOut() runs the revoke FIRST, then this.
// ⚠ NEITHER covers the user-scope `dopl` entry in the CLI's own config: it may be one the
// OPERATOR wrote with their own credential and we cannot tell the two apart. Residual: F-085.
function clearDeviceToken() {
  spawnToken = ''; // the in-memory copy buildMcpServers injects
  let ok = true;
  try {
    store.delete(DT_KEY);
    store.delete(DT_KEY_PLAIN);
  } catch (err) {
    ok = false;
    diag('mcp-config: device-token store clear failed', err && err.message);
  }
  try {
    fs.rmSync(spawnConfigPath(), { force: true });
  } catch (err) {
    ok = false;
    diag('mcp-config: spawn config unlink failed', err && err.message);
  }
  diag('mcp-config: device token cleared', ok ? '(store + spawn config)' : '(PARTIAL)');
  return ok;
}

// THE SERVER HALF OF SIGN-OUT. `DELETE /api/auth/mcp-device-token` stamps revoked_at, and
// validateAccessToken checks revoked_at before expiry, so the bearer dies on its next use
// rather than in up to 90 days.
// ⚠ Called by auth-state.signOut() BEFORE any local teardown — the route is sessionOnly and
// authenticates on the cookie jar sign-out is about to clear. Best-effort.
// ⚠ Use the label we MINTED under (persisted with the token), never a recomputed one: rename
// the Mac and a recomputed label revokes a row that never existed while the real token lives.
//
// ⚠ THREE OUTCOMES, NOT A BOOLEAN, and `res.ok` is NOT the answer — the route is idempotent, so
// an unknown label is a quiet `200 {ok:true, revoked:0}`. Label-less records (pre-label builds)
// fall back to a RECOMPUTED `os.hostname()`, which drifts on macOS and matches nothing, so the
// COUNT is the only discriminator.
//   'revoked'  — the server confirmed it stamped at least one row
//   'no-match' — 200, matched NOTHING
//   'none'     — nothing of ours to revoke; nothing was asked of the server. ⚠ NOT "revoked":
//                an earlier failed revoke may have cleared the local copies while the row stayed
//                live, and we cannot revoke blind because the label lives in the missing record.
//   'failed'   — we asked and it did not land
// ⚠ A 200 with no readable count is NOT downgraded: the request provably reached the route, and
// inventing a failure is its own false claim. The log names the missing count.
async function revokeDeviceToken() {
  const rec = loadDeviceToken();
  if (!rec || !rec.token) {
    diag('mcp-config: no local device token — nothing to revoke, and nothing claimed');
    return 'none';
  }
  const label = rec.label || deviceLabel();
  try {
    const res = await withTimeout(
      apiFetch(MCP_DEVICE_TOKEN_PATH, {
        method: 'DELETE',
        timeoutMs: REVOKE_TIMEOUT_MS,
        noStore: true,
        body: { label },
      }),
      REVOKE_TIMEOUT_MS + 500
    );
    if (!res) {
      diag('mcp-config: device-token revoke TIMED OUT — token stays valid server-side');
      return 'failed';
    }
    if (!res.ok) {
      diag('mcp-config: device-token revoke failed', res.status,
        '— token stays valid server-side until it expires; revoke it from web Settings > Devices');
      return 'failed';
    }
    let count = null;
    try {
      const data = typeof res.json === 'function' ? await res.json() : null;
      if (data && typeof data.revoked === 'number') count = data.revoked;
    } catch (_) {
      /* unreadable body — count stays unknown, handled below */
    }
    if (count === 0) {
      diag('mcp-config: device-token revoke matched NO token for label', label,
        '— nothing was revoked; if this machine ever minted one it is STILL VALID,',
        'revoke it from web Settings > Devices');
      return 'no-match';
    }
    diag('mcp-config: device token revoked server-side',
      count === null ? '(count not reported)' : `(${count})`);
    return 'revoked';
  } catch (err) {
    diag('mcp-config: device-token revoke error', (err && err.message) || String(err),
      '— token stays valid server-side until it expires; revoke it from web Settings > Devices');
    return 'failed';
  }
}

function parseExpiry(v) {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // seconds vs ms
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now() + 90 * 24 * 60 * 60 * 1000; // assume 90d
}

// ⚠ Set whenever obtainDeviceToken minted: server-side revoke-and-replace just invalidated any
// prior token, so the operator's CLI entry (`mcp-config.js`) must be refreshed too or manual CLI
// runs keep a revoked bearer until the next mint. Read through `mintWasFresh()`.
let lastMintWasFresh = false;
function mintWasFresh() {
  return lastMintWasFresh;
}

// Reuse the cached token while it has margin, else mint. null when neither is available
// (endpoint 404 / one-off failure and no cached fallback) — the caller retries next launch.
async function obtainDeviceToken() {
  const cached = loadDeviceToken();
  if (cached && cached.token && cached.expiresAt - Date.now() > REUSE_MARGIN_MS) {
    return cached.token;
  }
  let res;
  // ⚠ Held in a local so the EXACT label we minted under is what gets persisted, and therefore
  // what revokeDeviceToken later presents.
  const label = deviceLabel();
  try {
    res = await apiFetch(MCP_DEVICE_TOKEN_PATH, {
      method: 'POST',
      timeoutMs: 15_000,
      noStore: true,
      body: { label },
    });
  } catch (err) {
    diag('mcp-config: token fetch error', err && err.message);
    return cached ? cached.token : null;
  }
  if (res.status === 404) {
    diag('mcp-config: token endpoint 404 (web not deployed) — skip, retry next launch');
    return cached ? cached.token : null;
  }
  if (!res.ok) {
    diag('mcp-config: token fetch failed', res.status);
    return cached ? cached.token : null;
  }
  let data;
  try {
    data = await res.json();
  } catch (_) {
    diag('mcp-config: token response not json');
    return cached ? cached.token : null;
  }
  if (!data || !data.token) {
    diag('mcp-config: token response missing token');
    return cached ? cached.token : null;
  }
  const rec = { token: data.token, expiresAt: parseExpiry(data.expiresAt), label };
  // Older servers omit tokenId; the heartbeat then links by label.
  if (isUuid(data.tokenId)) rec.tokenId = data.tokenId;
  // A fresh mint is live for the NEXT session spawn without a restart — the in-memory copy is
  // what buildMcpServers injects, refreshed ahead of the write.
  spawnToken = String(rec.token);
  saveDeviceToken(rec);
  lastMintWasFresh = true;
  notifyMinted(rec.tokenId ? { tokenId: rec.tokenId } : { tokenLabel: label });
  diag('mcp-config: minted device token, expires', new Date(rec.expiresAt).toISOString());
  return rec.token;
}

// ── THE MINT ─────────────────────────────────────────────────────────────────
// MINTING DEPENDS ON THE DOPL SIGN-IN AND NOTHING ELSE (2026-10-10, launch-critical).
// The mint used to wait behind the EXTERNAL-binary probe in `mcp-config.js`, which the bundled
// binary a session runs cannot satisfy, so a Mac with no separately installed CLI never got a
// token: `buildMcpServers` returned `{}` and `mcp-connect-guard.js` ended every session
// `mcp-unreachable` after New Agent had already answered `{ ok: true }`. Minting needs neither a
// binary nor a CLI — only the session this app is signed in with. `saveDeviceToken` has exactly
// one caller (`obtainDeviceToken`), so this is the only minting path. Pinned by
// test/device-token-no-cli.test.mjs.
// ⚠ SINGLE-FLIGHT: the launch pre-flight (`delivery-path.js`) calls this on a click while
// startup's ensure may still be in flight, and two mints would revoke each other's token.
let minting = null;
function ensureDeviceToken() {
  if (minting) return minting;
  minting = ensureDeviceTokenInner().finally(() => {
    minting = null;
  });
  return minting;
}

/** '' when signed out or the mint failed; the bearer otherwise. Never throws. */
async function ensureDeviceTokenInner() {
  try {
    // ⚠ ASYNC gate: this runs at startup BEFORE the first reconcile warms the cookie-identity
    // cache, so it must re-read the jar itself. A sync blob-only check silently stops
    // refreshing the CLI's Dopl MCP entry whenever the blob is dead but the web UI is signed in.
    if (!(await auth.ensureSignedIn())) {
      diag('mcp-config: skip (signed out)');
      return '';
    }
    lastMintWasFresh = false;
    const token = await obtainDeviceToken();
    if (!token) {
      diag('mcp-config: NO DEVICE TOKEN (mint failed) — a session launched now would have no Dopl tools');
      return '';
    }
    return token;
  } catch (err) {
    diag('mcp-config: device-token ensure error', err && err.message);
    return '';
  }
}

module.exports = {
  ensureDeviceToken,
  mintWasFresh, // mcp-config.js › ensureMcpConfigInner: refresh the CLI entry after a fresh mint
  spawnConfigPath,
  deviceTokenForSpawn,
  deviceTokenLink,
  clearDeviceToken,
  revokeDeviceToken,
  REVOKE_TIMEOUT_MS,
};

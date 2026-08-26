// Dopl MCP auto-config for the Claude CLI. On a signed-in startup (and after a fresh sign-in):
//   1. Mint (or reuse) a long-lived device token from POST /api/auth/mcp-device-token.
//   2. Write userData/mcp-spawn.json (mode 600) carrying it, passed as `--mcp-config <path>` on
//      every spawn, so a responding agent has Dopl regardless of the CLI's global config.
//   3. Ensure a user-scope `dopl` entry exists in the CLI's own config (`claude mcp add …`),
//      NEVER churning an existing one.
//
// ⚠ NEVER reach into `~/.claude.json` to add a per-server `timeout` (mcp-cli-entry.js REMOVED).
// That file is the OPERATOR's — it holds their `oauthAccount` block — and `timeout` also LOWERS
// the hard tool-call ceiling (~27.8h -> the value) for their own terminal `claude` sessions.
// /api/mcp streams (c2f6a7e), so a long `op=await` hold is no longer 60s of silence. The fix
// belongs only on entries we own: the spawn-config file below and sdk-loader's in-memory
// server, both inside this process.
//
// ⚠ The token value NEVER hits logs/diag. Stored safeStorage-encrypted, written into the
// spawn-config file (600), and passed as a `claude mcp add` header argv.
// ⚠ The safeStorage cache is the ONLY source the SESSION path uses: `deviceTokenForSpawn()`
// hands sdk-loader.buildMcpServers the bearer in memory, so an SDK session never needs the
// file. Steps 2/3 exist for the CLI path alone (headless spawns + manual `claude` runs).

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');

const auth = require('./auth');
const spawner = require('./session-spawner');
const { probeMcpEntry, removeMcpEntry, addMcpEntry } = require('./mcp-cli-add');
const { apiFetch } = require('./api');
const { diag } = require('./diag');
const { MCP_URL, MCP_DEVICE_TOKEN_PATH } = require('./config');

const store = new Store();
const DT_KEY = 'mcpDeviceToken'; // safeStorage-encrypted base64(JSON{token,expiresAt})
const DT_KEY_PLAIN = 'mcpDeviceTokenPlain';
const REUSE_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // re-mint when <7d remain
// ⚠ THE ONE DEFINITION of the per-server call abort every Dopl MCP entry this app writes must
// carry — feeds the spawn-config file below AND sdk-loader's in-memory entry, which imports it
// rather than restating it.
// ⚠ DO NOT HAND-TUNE. Arithmetic over packages/mcp-server/src/tools/channel-await-budget.ts:
//   AWAIT_HOLD_CAP_MS 230_000    the LONGEST hold a caller can get via explicit `timeout_ms`
//                                (the 215_000 DEFAULT is not the bound that matters)
//   AWAIT_HOLD_MARGIN_MS 60_000  auth + MCP boot + workspace handshake on top of any hold
//   => must not abort before 290_000; MCP_ROUTE_MAX_DURATION_MS (300_000) is the upper bound.
// test/mcp-client-timeout.test.mjs pins the RELATION, so moving the cap fails a test.
// Verified against claude-agent-sdk 0.3.220 / Claude Code 2.1.220: the per-server `timeout`
// sets the HTTP abort to `min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647)`
// — it can only RAISE above the 60s floor — and also LOWERS the hard tool-call ceiling from
// ~1e8 ms to this value. Both effects confined to entries this process owns.
const MCP_CLIENT_TIMEOUT_MS = 290_000;
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
function withTimeout(promise, ms) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ── Spawn-config file (used via --mcp-config on every spawn) ─────────────────
function spawnConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-spawn.json');
}

// ⚠ The EXACT bytes this file must contain for a given token. Serialized once and compared
// WHOLE, so every field is repaired, not just the bearer.
// ⚠ The CLI path carries `X-Dopl-Runtime: desktop-session` too: a headless spawn IS a session
// this app owns, but it reaches MCP through this file rather than sdk-loader's in-memory entry,
// so without the header the server reads it as EXTERNAL and the two spawn paths disagree about
// the same machine. Routing hint only (src/shared/auth/runtime-header.ts) — grants nothing.
function spawnConfigBody(token) {
  return JSON.stringify({
    mcpServers: {
      dopl: {
        type: 'http',
        url: MCP_URL,
        // ⚠ Without this the client aborts any call at 60s — before the ~2min backgrounding
        // mark that makes op="await" a wake primitive. See the constant for the derivation.
        timeout: MCP_CLIENT_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Dopl-Runtime': 'desktop-session',
        },
      },
    },
  });
}

function currentSpawnBody() {
  try {
    return fs.readFileSync(spawnConfigPath(), 'utf8');
  } catch (_) {
    return '';
  }
}

// Rewrite whenever the CONTENT differs.
// ⚠ The chmod runs on EVERY call, not only on a rewrite: `writeFileSync`'s mode applies only at
// creation, and the unchanged-content fast path returns before it. A file left at 644 by an
// older build or a restore/copy would otherwise stay world-readable for the 90-day token's
// whole lifetime.
// ⚠ The fast path compares the WHOLE serialized config, not the token alone. Comparing only
// headers.Authorization lets a local process rewrite `url` to its own endpoint and keep the
// file declared correct forever — handing that endpoint the bearer and every tool call.
function writeSpawnConfig(token) {
  try {
    fs.chmodSync(spawnConfigPath(), 0o600);
  } catch (_) {
    /* not created yet — the write below sets the mode */
  }
  const body = spawnConfigBody(token);
  if (currentSpawnBody() === body) return true;
  try {
    fs.writeFileSync(spawnConfigPath(), body, { mode: 0o600 });
    fs.chmodSync(spawnConfigPath(), 0o600);
    diag('mcp-config: wrote spawn config (600)');
    return true;
  } catch (err) {
    diag('mcp-config: spawn config write failed', err && err.message);
    return false;
  }
}

// ── Device-token cache (safeStorage) ─────────────────────────────────────────
function saveDeviceToken(obj) {
  try {
    // A fresh mint is live for the NEXT session spawn without a restart — the in-memory copy
    // is what buildMcpServers injects.
    if (obj && obj.token) spawnToken = String(obj.token);
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

// ⚠ THE SDK PATH'S BEARER, never a file read. Parsing the token out of mcp-spawn.json puts a
// 90-day dopl.read+dopl.write credential in plaintext under a path every profile's PRE-APPROVED
// (therefore gate-bypassing) Read tool can open. This reads the safeStorage cache instead:
// decrypted on demand, memoized for the process life, never logged. '' when nothing usable
// (pre-sign-in), which hands the session an empty mcpServers object.
let spawnToken = '';
function deviceTokenForSpawn() {
  if (spawnToken) return spawnToken;
  const rec = loadDeviceToken();
  const token = rec && rec.token ? String(rec.token) : '';
  if (token) spawnToken = token;
  return token;
}

// ⚠ SIGN-OUT TEARDOWN FOR THE MCP CREDENTIAL — LOCAL HALF ONLY. Without it, sign-out clears the
// Supabase blob and the cookie jar and leaves a 90-day dopl.read+dopl.write device token live
// in electron-store (DT_KEY / DT_KEY_PLAIN) and in userData/mcp-spawn.json — full API access to
// the account that just signed out, for anything that can read the app's data dir, the next
// operator on this machine included.
// ⚠ PAIR WITH revokeDeviceToken() below, which kills the token SERVER-side. Deleting our copies
// does not invalidate the credential: anything that already read it keeps full API access until
// the token expires. signOut() runs the revoke FIRST, then this.
// ⚠ NEITHER covers the user-scope `dopl` entry in the CLI's own config: `ensureMcpConfig` adds
// it only when confirmed absent, so an existing entry may be one the OPERATOR wrote with their
// own credential and we cannot tell the two apart from outside. Deleting a hand-made entry is
// worse than leaving a bearer the revoke already killed. Residual tracked in F-085.
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
// authenticates on the cookie jar sign-out is about to clear. Best-effort: a failure is
// diagnosed and sign-out continues.
// ⚠ Use the label we MINTED under (persisted with the token), never a recomputed one: rename
// the Mac and a recomputed label revokes a row that never existed while the real token lives.
//
// ⚠ THREE OUTCOMES, NOT A BOOLEAN, and `res.ok` is NOT the answer — the route is idempotent by
// design, so an unknown label is a quiet `200 {ok:true, revoked:0}` indistinguishable from a
// real kill. `rec.label` is only PERSISTED as of this round, so every already-installed machine
// carries a label-less record until its next 90-day re-mint and falls back to a RECOMPUTED
// `os.hostname()` — which drifts on macOS (Bonjour renames, "Foo" vs "Foo.local") and matches
// nothing. The COUNT is the only discriminator, so it is read and reported.
//   'revoked'  — the server confirmed it stamped at least one row
//   'no-match' — 200, matched NOTHING
//   'none'     — nothing of ours to revoke; nothing was asked of the server. ⚠ NOT "revoked":
//                the local copies may have been cleared by an earlier failed revoke while the
//                90-day row stayed live, and we cannot revoke blind because the label lives in
//                the record we just failed to find.
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
        '— token stays valid server-side until it expires; revoke it from web Settings > Connected apps');
      return 'failed';
    }
    // ⚠ Inlined on purpose: `revokeDeviceToken` is source-sliced by the tests, so a helper
    // would be an undefined free variable in every harness.
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
        'revoke it from web Settings > Connected apps');
      return 'no-match';
    }
    diag('mcp-config: device token revoked server-side',
      count === null ? '(count not reported)' : `(${count})`);
    return 'revoked';
  } catch (err) {
    diag('mcp-config: device-token revoke error', (err && err.message) || String(err),
      '— token stays valid server-side until it expires; revoke it from web Settings > Connected apps');
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
  saveDeviceToken(rec);
  lastMintWasFresh = true;
  diag('mcp-config: minted device token, expires', new Date(rec.expiresAt).toISOString());
  return rec.token;
}

// ⚠ Set whenever obtainDeviceToken minted: server-side revoke-and-replace just invalidated any
// prior token, so the global CLI entry must be refreshed too or manual `claude` runs keep a
// revoked bearer until the next mint.
let lastMintWasFresh = false;

// ── CLI entry ensure ─────────────────────────────────────────────────────────
// The three `claude mcp …` child processes live in mcp-cli-add.js. Best-effort; never throws.
// ⚠ SINGLE-FLIGHT: startup and post-sign-in both call this, and overlapping calls must coalesce
// or we mint two tokens / double-add the CLI entry.
let ensuring = null;
function ensureMcpConfig() {
  if (ensuring) return ensuring;
  ensuring = ensureMcpConfigInner().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

async function ensureMcpConfigInner() {
  try {
    // ⚠ ASYNC gate: this runs at startup BEFORE the first reconcile warms the cookie-identity
    // cache, so it must re-read the jar itself. A sync blob-only check silently stops
    // refreshing the CLI's Dopl MCP entry whenever the blob is dead but the web UI is signed in.
    if (!(await auth.ensureSignedIn())) {
      diag('mcp-config: skip (signed out)');
      return;
    }
    const bin = await spawner.getClaudeBinPath();
    if (!bin) {
      diag('mcp-config: skip (claude cli unresolved)');
      return;
    }
    lastMintWasFresh = false;
    const token = await obtainDeviceToken();
    if (!token) {
      diag('mcp-config: skip (no device token)');
      return;
    }
    writeSpawnConfig(token);

    const probe = await probeMcpEntry(bin);
    if (probe.state === 'unknown') {
      // The CLI did not answer. Adding risks a duplicate and rewriting risks clobbering an
      // entry we cannot see, so this is the one branch that still touches nothing.
      diag('mcp-config: dopl entry unknown (cli did not answer) — leaving alone');
      return;
    }
    if (probe.state === 'present') {
      // ⚠ ORIGIN DRIFT IS A REPAIR CASE, NOT A "LEAVE ALONE" CASE (2026-08-25). Until this
      // branch existed, ANY existing entry was preserved and the ONLY thing that could refresh
      // one was a fresh mint. So an entry written while this app pointed at one origin survived
      // every later boot against a DIFFERENT one, and manual `claude` runs kept calling a dead
      // endpoint forever. Measured on this machine the day it was fixed: the app booted with
      // DOPL_APP_URL=http://localhost:3001 while the entry still read
      // `URL: http://localhost:3000/api/mcp`, and `claude mcp get dopl` reported
      // `✘ Failed to connect — ConnectionRefused`. The log line for it was, in as many words,
      // "dopl entry present/unknown — leaving alone".
      //
      // ⚠ THE SDK SESSION PATH WAS NEVER AFFECTED and that is why this hid for so long:
      // `sdk-loader.js › buildMcpServers` builds its entry in memory off the compiled-in
      // MCP_URL, and `writeSpawnConfig` above repairs the headless spawn file by WHOLE-body
      // comparison. This CLI entry was the one Dopl MCP surface with no origin repair at all.
      //
      // ⚠ WHAT THIS MAY STOMP, STATED RATHER THAN HIDDEN. F-085's argument for never touching an
      // existing entry is that it may be one the OPERATOR hand-wrote with their own credential,
      // and from outside we cannot tell. That argument still holds for a MATCHING url — which is
      // why the equal case is left alone — but it cannot survive a mismatch: an entry naming a
      // Dopl MCP endpoint this app is not talking to is broken for the operator either way, and
      // a broken entry preserved out of politeness is worse than a working one they can re-point
      // by relaunching against the origin they meant.
      const drifted = probe.url && probe.url !== MCP_URL;
      if (lastMintWasFresh || drifted) {
        // A fresh mint revoked the token the global entry carries — refresh it so manual
        // `claude` runs do not 401 until the next mint cycle. A drifted url is the same repair.
        const removed = await removeMcpEntry(bin);
        const readded = removed && (await addMcpEntry(bin, token));
        // ⚠ The REASON, never the urls: `probe.url` is read off the operator's own config and
        // MCP_URL is ours. Neither is a credential, but this file's rule is that nothing parsed
        // out of that stdout is echoed, so the log says WHICH repair ran and stops there.
        diag('mcp-config: dopl entry refreshed', drifted ? '(origin drift)' : '(fresh mint)',
          readded ? 'ok' : 'FAILED');
      } else {
        diag('mcp-config: dopl entry present and on the current origin — leaving alone');
      }
      return;
    }
    const added = await addMcpEntry(bin, token);
    diag('mcp-config: dopl entry add', added ? 'ok' : 'FAILED');
  } catch (err) {
    diag('mcp-config: ensure error', err && err.message);
  }
}

module.exports = {
  ensureMcpConfig,
  spawnConfigPath,
  deviceTokenForSpawn, // the SDK path's bearer, from safeStorage — never off disk
  clearDeviceToken, // S2: sign-out teardown, LOCAL (auth-state.signOut)
  revokeDeviceToken, // F-085: sign-out teardown, SERVER-side (auth-state.signOut)
  spawnConfigBody, // the exact bytes writeSpawnConfig compares against
  MCP_CLIENT_TIMEOUT_MS, // Q9: ONE definition — sdk-loader reads it from here
};

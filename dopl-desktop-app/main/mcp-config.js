// Feature E — Dopl MCP auto-config for the Claude CLI.
//
// On a signed-in startup (and after a fresh sign-in) we make sure the responding
// agents can reach Dopl's MCP:
//   1. Mint (or reuse) a long-lived device token from the cookie-authed endpoint
//      POST /api/auth/mcp-device-token.
//   2. Write userData/mcp-spawn.json (mode 600) carrying that token, and pass
//      `--mcp-config <path>` on every spawn (session-spawner) so a responding
//      agent always has Dopl regardless of the CLI's global config.
//   3. Ensure a user-scope `dopl` entry exists in the CLI's own config
//      (`claude mcp add …`), NEVER churning an existing one.
//
// WHAT STEP 3 DELIBERATELY DOES NOT DO (2026-07-31, mcp-cli-entry.js REMOVED).
// It does not reach into `~/.claude.json` to add a per-server `timeout` the CLI
// has no flag for. That file is the OPERATOR's, it holds their `oauthAccount`
// block, and `timeout` also LOWERS the hard tool-call ceiling (~27.8h → the
// value) for their own terminal `claude` sessions — a change we would be making
// on their behalf without asking. The reason it was written no longer holds
// either: `/api/mcp` streams (c2f6a7e), so a long `op=await` hold is no longer
// 60s of silence to the client. The fix belongs on the entries we own and
// nowhere else — the spawn-config file below and sdk-loader's in-memory server,
// both entirely inside this process.
//
// The token value NEVER hits logs/diag. It is stored safeStorage-encrypted and
// is written into the spawn-config file (600) and passed as a `claude mcp add`
// header argv (the CLI's only interface for it — not logged).
//
// C1 (HIGH-2): the safeStorage cache is now also the ONLY source the SESSION path
// uses. `deviceTokenForSpawn()` hands sdk-loader.buildMcpServers the bearer in
// memory, so an SDK session never needs the file; steps 2/3 above remain for the
// CLI path alone (headless spawns + manual `claude` runs).

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');

const auth = require('./auth');
const spawner = require('./session-spawner');
const { mcpEntryConfirmedAbsent, removeMcpEntry, addMcpEntry } = require('./mcp-cli-add');
const { apiFetch } = require('./api');
const { diag } = require('./diag');
const { MCP_URL, MCP_DEVICE_TOKEN_PATH } = require('./config');

const store = new Store();
const DT_KEY = 'mcpDeviceToken'; // safeStorage-encrypted base64(JSON{token,expiresAt})
const DT_KEY_PLAIN = 'mcpDeviceTokenPlain';
const REUSE_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // re-mint when <7d remain
// FIX Q9 — the per-server call abort every Dopl MCP entry this app writes must
// carry. THE ONE DEFINITION: this constant feeds the spawn-config file below AND
// sdk-loader's in-memory server entry, which imports it rather than restating it.
//
// HOW THE NUMBER IS DERIVED (do not hand-tune it — it is arithmetic over
// packages/mcp-server/src/tools/channel-await-budget.ts):
//   AWAIT_HOLD_CAP_MS 230_000 — the LONGEST hold a caller can actually get, via
//     an explicit `timeout_ms`. The 215_000 DEFAULT is NOT the bound that matters.
//   AWAIT_HOLD_MARGIN_MS 60_000 — what the route needs on top of any hold for
//     auth + MCP boot + the workspace handshake.
//   ⇒ the client must not abort before 230_000 + 60_000 = 290_000, and
//     MCP_ROUTE_MAX_DURATION_MS (300_000) is the upper bound (waiting past the
//     point the platform kills the function buys nothing).
// The previous value (280s, justified against the 215s DEFAULT) left 50s of
// margin — under the repo's own 60s. test/mcp-client-timeout.test.mjs pins the
// RELATION, so moving the cap fails a test instead of drifting silently.
//
// VERSION-QUALIFIED (verified 2026-07-31 against @anthropic-ai/claude-agent-sdk
// 0.3.220, bundling Claude Code 2.1.220): a per-server `timeout` IS honoured at
// runtime. It sets the HTTP request abort to
// `min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647)` — so it
// can only RAISE the abort above the 60s floor, never lower it — and it also
// LOWERS the hard tool-call ceiling from its ~1e8 ms default to this value.
// Both effects are confined to entries this process owns.
const MCP_CLIENT_TIMEOUT_MS = 290_000;
// F-085: sign-out is a CLICK. The server revoke is best-effort and must never
// hold it — offline, captive-portal or 5xx all fall through to local teardown.
const REVOKE_TIMEOUT_MS = 3_000;

// The label this machine mints under. The server keys revoke-and-replace on
// (user, label), so the hostname keeps two Macs from churning each other's
// tokens. ONE definition, because mint and revoke must agree: a label that
// drifts between them revokes nothing and leaves the live token behind.
function deviceLabel() {
  try {
    return `Dopl Desktop CLI (${require('os').hostname()})`;
  } catch (_) {
    return 'Dopl Desktop CLI';
  }
}

// Bound a promise that may not settle. apiFetch's own AbortController covers the
// fetch, but getAuthCookie() ahead of it can await a token refresh, so the whole
// call needs an outer stop. Resolves null on timeout; the loser is left to
// settle on its own (its rejection is already handled by the race).
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

// The EXACT bytes this file must contain for a given token. Serialized once and
// compared whole (C2), so every field is repaired, not just the bearer.
//
// FIX L4 (WAKE-V1): the CLI path carries `X-Dopl-Runtime: desktop-session` too.
// A headless spawn IS a session this app owns — the same requester-window
// routing should apply to it — but it reaches MCP through this file rather than
// sdk-loader's in-memory entry, so without the header here the server read it
// as an EXTERNAL session and the two spawn paths disagreed about the same
// machine. It is a routing hint only (src/shared/auth/runtime-header.ts): it
// grants nothing, and a caller who forges it still gets no window unless the
// message is their own create of their own thread.
function spawnConfigBody(token) {
  return JSON.stringify({
    mcpServers: {
      dopl: {
        type: 'http',
        url: MCP_URL,
        // FIX Q9: without this the client aborts any call at 60s, which is before the
        // ~2min backgrounding mark that makes op="await" a wake primitive. Belt-and-
        // braces since the route started streaming; see the constant for the derivation.
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

// Refresh the file whenever its CONTENT differs (avoids needless rewrites). Mode
// 600 on create AND an explicit chmod so a pre-existing file is tightened too.
//
// This file holds a 90-day dopl.read+dopl.write device token, so the chmod must
// happen on EVERY call, not only on a rewrite: `writeFileSync`'s mode applies
// only when the file is created, and the unchanged-token fast path below used to
// return before any chmod ran. A file left at 644 by an older build (or by a
// restore/copy) therefore stayed world-readable for the token's whole lifetime.
//
// C2 (HIGH-3): the fast path compares the WHOLE serialized config, not the token
// alone. The old check read only headers.Authorization, so a local process could
// rewrite `url` to its own endpoint and we would keep declaring the file correct
// forever — the CLI path would then hand the bearer (and every tool call) to that
// endpoint. Anything but the exact expected bytes is now rewritten.
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
    // C1: a fresh mint is live for the NEXT session spawn without a restart (the
    // in-memory copy is what buildMcpServers injects).
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

// C1 (HIGH-2) — THE SDK PATH'S BEARER, never a file read. sdk-loader.buildMcpServers used
// to parse the token out of mcp-spawn.json on every session spawn, which meant a 90-day
// dopl.read+dopl.write credential sat in plaintext under a path that every profile's
// PRE-APPROVED (therefore gate-bypassing) Read tool could open. The token is already
// cached safeStorage-encrypted for the CLI path, so the session path reads THAT instead:
// decrypted on demand, memoized in memory for the life of the process, never logged.
// Returns '' when there is nothing usable (pre-sign-in) — buildMcpServers then hands the
// session an empty mcpServers object exactly as a missing file used to.
let spawnToken = '';
function deviceTokenForSpawn() {
  if (spawnToken) return spawnToken;
  const rec = loadDeviceToken();
  const token = rec && rec.token ? String(rec.token) : '';
  if (token) spawnToken = token;
  return token;
}

// FIX S2 (Q5 review) — THE SIGN-OUT TEARDOWN FOR THE MCP CREDENTIAL.
//
// Sign-out cleared the Supabase blob and the cookie jar and stopped there, which left
// the OTHER credential this app holds fully live: a 90-day `dopl.read` + `dopl.write`
// device token, in electron-store under DT_KEY / DT_KEY_PLAIN and in
// userData/mcp-spawn.json (mode 600, bearer in the Authorization header). Anything able
// to read the app's data dir — including the next operator to sign in on this machine —
// kept complete API access to the account that had just signed out. Called by
// auth-state.signOut().
//
// LOCAL HALF ONLY — pair it with revokeDeviceToken() below (F-085), which kills the
// token SERVER-side. Deleting our copies does not invalidate the credential: anything
// that already read it (a backup, a previous `claude mcp add`, a snooping process) keeps
// full API access until the token expires. signOut() runs the revoke first, then this.
//
// NOT covered by either: the user-scope `dopl` entry the CLI keeps in its OWN config
// (`claude mcp add … --header Authorization: Bearer …`). We deliberately leave it —
// `ensureMcpConfig` only ever adds that entry when it was confirmed absent, so an entry
// that exists now may be one the OPERATOR wrote with their own credential, and we cannot
// tell the two apart from outside. Deleting a hand-made global config entry is worse than
// leaving a bearer the revoke above has already made dead (it 401s, and the next sign-in
// refreshes it via the lastMintWasFresh path). Residual tracked in F-085.
function clearDeviceToken() {
  spawnToken = ''; // C1: the in-memory copy buildMcpServers injects
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

// F-085 — THE SERVER HALF OF SIGN-OUT. `DELETE /api/auth/mcp-device-token`
// stamps revoked_at on this machine's device token, and validateAccessToken
// checks revoked_at before expiry, so the bearer is dead on its very next use
// rather than in up to 90 days.
//
// Called by auth-state.signOut() BEFORE any local teardown, because the route is
// sessionOnly: it authenticates on the cookie jar that sign-out is about to
// clear. Best-effort in every direction — a failure is diagnosed and sign-out
// continues, because a signed-out app is more important than a revoked token and
// the local teardown still removes our copies.
//
// The label is the one we MINTED under (persisted with the token), not the one
// this machine would compute today: rename the Mac and a recomputed label would
// revoke a row that never existed while the real token stayed live.
//
// FIX M4 (production hardening, batch 1) — THREE OUTCOMES, NOT A BOOLEAN.
// This used to return `true` when there was no local record, and signOut then
// printed "+ revoked server-side" — a claim we had made no request to support.
// "We hold no copy" is NOT "the credential is dead": the local copies may have
// been cleared by an earlier sign-out whose revoke failed, or by a wiped
// electron-store, while the 90-day row stayed live. And we cannot revoke blind:
// the label is the only selector and it lives in the record we just failed to
// find, so a guessed label (a renamed Mac) would 200 having revoked NOTHING —
// re-creating this exact false confidence one layer down. So we report it and
// let the sign-out line say what is actually true.
//   'revoked'  — the server confirmed it stamped at least one row
//   'no-match' — the server answered 200 and matched NOTHING (see below)
//   'none'     — nothing of ours to revoke, and nothing was asked of the server
//   'failed'   — we asked and it did not land
//
// FIX (2026-07-31) — `res.ok` WAS NOT THE ANSWER. The route is idempotent BY
// DESIGN: an unknown label is a quiet `200 {ok:true, revoked:0}`, so a DELETE
// that matched zero rows looked identical to one that killed a live credential
// and sign-out printed "+ revoked server-side" over a 90-day dopl.read+write
// bearer that was still valid. That is not theoretical: `rec.label` is only
// PERSISTED as of this round, so every already-installed machine carries a
// label-less record until its next 90-day re-mint and falls back to a
// RECOMPUTED `os.hostname()` — which drifts on macOS (Bonjour renames, "Foo" vs
// "Foo.local"). Those machines match nothing. The count is the only thing that
// distinguishes the two, so it is read and reported.
//
// A 200 whose body carries no readable count is NOT downgraded: the request
// provably reached the route (it only 200s after revokeDeviceTokens returns) and
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
    // Inlined on purpose: `revokeDeviceToken` is source-sliced by the tests, so a
    // helper would become an undefined free variable in every harness.
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

// Return a usable device token: reuse the cached one while it has margin, else
// mint a fresh one. Returns null when we can't obtain one (endpoint 404/one-off
// failure) AND have no cached fallback — caller then skips and retries next launch.
async function obtainDeviceToken() {
  const cached = loadDeviceToken();
  if (cached && cached.token && cached.expiresAt - Date.now() > REUSE_MARGIN_MS) {
    return cached.token;
  }
  let res;
  // Per-device label: the server revokes prior tokens with the same label on
  // re-mint, so the hostname keeps two machines from churning each other. Held
  // in a local so the EXACT label we minted under is what gets persisted (and
  // therefore what revokeDeviceToken later presents).
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

// Set whenever obtainDeviceToken minted (server-side revoke-and-replace just
// invalidated any prior token) — the global CLI entry must be refreshed too,
// or manual `claude` runs keep a revoked bearer until the next mint.
let lastMintWasFresh = false;

// ── CLI entry ensure ─────────────────────────────────────────────────────────
// The three `claude mcp …` child processes live in mcp-cli-add.js (§2 split).
// Public entry point. Best-effort; never throws. Single-flight: startup and
// post-sign-in can both call this — overlapping calls coalesce so we never
// mint two tokens or double-add the CLI entry.
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
    // Q4: async gate — this runs at startup, BEFORE the first reconcile has
    // warmed the cookie-identity cache, so it must re-read the jar itself. The
    // old sync blob-only check is why a dead blob silently stopped refreshing the
    // CLI's Dopl MCP entry while the web UI was signed in.
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

    const absent = await mcpEntryConfirmedAbsent(bin);
    if (!absent) {
      if (lastMintWasFresh) {
        // A fresh mint revoked the token the global entry carries — refresh it
        // so manual `claude` runs don't 401 until the next mint cycle.
        const removed = await removeMcpEntry(bin);
        const readded = removed && (await addMcpEntry(bin, token));
        diag('mcp-config: dopl entry refreshed after mint', readded ? 'ok' : 'FAILED');
      } else {
        diag('mcp-config: dopl entry present/unknown — leaving alone');
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
  deviceTokenForSpawn, // C1: the SDK path's bearer, from safeStorage — never off disk
  clearDeviceToken, // S2: sign-out teardown, LOCAL (auth-state.signOut)
  revokeDeviceToken, // F-085: sign-out teardown, SERVER-side (auth-state.signOut)
  spawnConfigBody, // C2: the exact bytes writeSpawnConfig compares against
  MCP_CLIENT_TIMEOUT_MS, // Q9: ONE definition — sdk-loader reads it from here
};

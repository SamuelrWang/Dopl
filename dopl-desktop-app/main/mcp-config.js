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
const { execFile } = require('child_process');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');

const auth = require('./auth');
const spawner = require('./session-spawner');
const { apiFetch } = require('./api');
const { diag } = require('./diag');
const { MCP_URL, MCP_DEVICE_TOKEN_PATH } = require('./config');

const store = new Store();
const DT_KEY = 'mcpDeviceToken'; // safeStorage-encrypted base64(JSON{token,expiresAt})
const DT_KEY_PLAIN = 'mcpDeviceTokenPlain';
const REUSE_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // re-mint when <7d remain
const CLI_TIMEOUT_MS = 25_000;

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
  try {
    // Per-device label: the server revokes prior tokens with the same label on
    // re-mint, so the hostname keeps two machines from churning each other.
    res = await apiFetch(MCP_DEVICE_TOKEN_PATH, {
      method: 'POST',
      timeoutMs: 15_000,
      noStore: true,
      body: { label: `Dopl Desktop CLI (${require('os').hostname()})` },
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
  const rec = { token: data.token, expiresAt: parseExpiry(data.expiresAt) };
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
// Confirmed-absent only when `claude mcp get dopl` exits 1 (or says so). Any
// ambiguity (timeout, spawn error) returns false → we do NOT add, so we never
// create a duplicate entry.
function mcpEntryConfirmedAbsent(bin) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['mcp', 'get', 'dopl'],
      { timeout: CLI_TIMEOUT_MS, env: spawner.cliEnv(bin), windowsHide: true },
      (err, stdout) => {
        if (!err) {
          resolve(false); // present
          return;
        }
        const out = String(stdout || '') + ' ' + String((err && err.message) || '');
        if (err.code === 1 || /No MCP server named/i.test(out)) {
          resolve(true); // confirmed absent
          return;
        }
        diag('mcp-config: get ambiguous —', err.code || (err && err.message));
        resolve(false); // unknown → don't add (avoid dupes)
      }
    );
  });
}

function removeMcpEntry(bin) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['mcp', 'remove', '--scope', 'user', 'dopl'],
      { timeout: CLI_TIMEOUT_MS, env: spawner.cliEnv(bin), windowsHide: true },
      (err) => resolve(!err)
    );
  });
}

function addMcpEntry(bin, token) {
  return new Promise((resolve) => {
    execFile(
      bin,
      [
        'mcp', 'add', '--transport', 'http', 'dopl', MCP_URL,
        '--scope', 'user',
        // Single argv element — execFile takes no shell, so the token is never
        // exposed on a shell command line. It is the CLI's only interface here.
        '--header', `Authorization: Bearer ${token}`,
      ],
      { timeout: CLI_TIMEOUT_MS, env: spawner.cliEnv(bin), windowsHide: true },
      (err) => resolve(!err)
    );
  });
}

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
    if (!auth.isSignedIn()) {
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
  spawnConfigBody, // C2: the exact bytes writeSpawnConfig compares against
};

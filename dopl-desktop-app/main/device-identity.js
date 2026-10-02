// This install's identity as a "computer" device of the signed-in user (Settings >
// Devices). `X-Dopl-Device` rides both fetch seams (api.js, listener-io.js) so the server can link
// the MCP tokens it mints to this computer; the heartbeat body is `descriptor()`.
//
// Requireable outside Electron: electron-store is loaded lazily and falls back to memory, and
// nothing here shells out on require (api.js loads this module and only reads `installId`).
// The name/OS reads are async (`refresh()`), so `descriptor()` on the beat path never shells out.

const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { appVersion } = require('./app-version');
const { isUuid } = require('./ipc-guards');

const HEADER = 'X-Dopl-Device';
const STORE_KEY = 'deviceInstallId';
const NAME_MAX = 64;
const OS_VERSION_MAX = 32;
const ARCH_MAX = 16;
const NAME_TTL_MS = 10 * 60 * 1000; // ComputerName can be renamed while the app runs
const EXEC_TIMEOUT_MS = 1500;

let store; // undefined = not opened yet; null = unavailable (memory only)
let memoryId = '';
// electron-store re-reads its file on every get, and this is read on every request.
let cachedId = '';
let cachedName = ''; // from refresh(); '' until the async read lands
let cachedOsVersion = '';
let refreshedAt = 0;
let refreshing = null;
let execImpl = null; // tests inject; default is promisified execFile

function openStore() {
  if (store !== undefined) return store;
  try {
    const Store = require('electron-store');
    store = new Store();
  } catch (_) {
    store = null;
  }
  return store;
}

/** Tests only: inject a `{get,set}` store (or null for memory-only) and forget cached state. */
function _setStore(s) {
  store = s;
  memoryId = '';
  cachedId = '';
  cachedName = '';
  cachedOsVersion = '';
  refreshedAt = 0;
  refreshing = null;
}

/** Tests only: inject `(cmd, args, opts) => Promise<string|{stdout}>`; null restores execFile. */
function _setExec(fn) {
  execImpl = fn;
}

function installId() {
  if (cachedId) return cachedId;
  const s = openStore();
  if (s) {
    try {
      const v = s.get(STORE_KEY);
      if (isUuid(v)) return (cachedId = v);
      const fresh = crypto.randomUUID();
      s.set(STORE_KEY, fresh);
      return (cachedId = fresh);
    } catch (_) { /* unreadable store — fall through to memory */ }
  }
  if (!memoryId) memoryId = crypto.randomUUID();
  return memoryId;
}

// After a remote removal: the next sign-in registers a fresh device instead of the revoked one.
function rotateInstallId() {
  const fresh = crypto.randomUUID();
  cachedId = '';
  const s = openStore();
  if (s) {
    try { s.set(STORE_KEY, fresh); return (cachedId = fresh); } catch (_) { /* memory below */ }
  }
  memoryId = fresh;
  return fresh;
}

function clampName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

/** `Samuels-MacBook-Pro.local` → `Samuels MacBook Pro`. Only for hostnames, never ComputerName. */
function cleanHostname(host) {
  const h = String(host || '').trim().replace(/\.(local|lan|localdomain|home)$/i, '');
  return clampName(h.replace(/-/g, ' '));
}

function mapPlatform(p) {
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

async function run(cmd, args) {
  try {
    const exec = execImpl || promisify(execFile);
    const out = await exec(cmd, args, { timeout: EXEC_TIMEOUT_MS, encoding: 'utf8' });
    return String((out && typeof out === 'object' ? out.stdout : out) || '').trim();
  } catch (_) {
    return '';
  }
}

function hostnameName(hostname = os.hostname) {
  let v = '';
  try { v = cleanHostname(hostname()); } catch (_) { v = ''; }
  return v || 'Computer';
}

/**
 * Re-read ComputerName + OS version off the beat path. Single-flight, never rejects. Called at
 * arm time and kicked (not awaited) by `descriptor()` once the cache is older than NAME_TTL_MS.
 */
function refresh({ platform = process.platform, now = Date.now } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const mac = platform === 'darwin';
    const [name, osv] = await Promise.all([
      mac ? run('/usr/sbin/scutil', ['--get', 'ComputerName']) : '',
      mac ? run('/usr/bin/sw_vers', ['-productVersion']) : '',
    ]);
    // A failed read keeps the last good value.
    const n = clampName(name);
    if (n) cachedName = n;
    const v = String(osv || '').slice(0, OS_VERSION_MAX);
    if (v) cachedOsVersion = v;
    refreshedAt = now();
  })().catch(() => {}).finally(() => { refreshing = null; });
  return refreshing;
}

function kickIfStale(now) {
  if (!refreshing && now - refreshedAt >= NAME_TTL_MS) refresh();
}

/** Sync: the cached ComputerName, else the cleaned hostname. Never shells out. */
function friendlyName({ hostname = os.hostname } = {}) {
  return cachedName || hostnameName(hostname);
}

function osVersion() {
  if (cachedOsVersion) return cachedOsVersion;
  try { return String(os.release() || '').slice(0, OS_VERSION_MAX); } catch (_) { return ''; }
}

function descriptor(status, { now = Date.now() } = {}) {
  kickIfStale(now);
  const body = {
    installId: installId(),
    name: friendlyName(),
    platform: mapPlatform(process.platform),
    status,
  };
  const osv = osVersion();
  if (osv) body.osVersion = osv;
  const av = appVersion();
  if (av) body.appVersion = av.slice(0, 32);
  const arch = String(process.arch || '').slice(0, ARCH_MAX);
  if (arch) body.arch = arch;
  return body;
}

// `{}` when unknown, like `appVersion.versionHeaders()`, so callers spread without branching.
function deviceHeaders() {
  let id = '';
  try { id = installId(); } catch (_) { id = ''; }
  return id ? { [HEADER]: id } : {};
}

module.exports = {
  HEADER,
  STORE_KEY,
  NAME_MAX,
  installId,
  rotateInstallId,
  friendlyName,
  osVersion,
  refresh,
  descriptor,
  deviceHeaders,
  clampName,
  cleanHostname,
  mapPlatform,
  _setStore,
  _setExec,
};

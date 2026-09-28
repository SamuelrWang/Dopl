// This install's identity as a "computer" device of the signed-in user (Settings > Connect >
// Devices). `X-Dopl-Device` rides both fetch seams (api.js, listener-io.js) so the server can link
// the MCP tokens it mints to this computer; the heartbeat body is `descriptor()`.
//
// Requireable outside Electron: electron-store is loaded lazily and falls back to memory, and
// nothing here shells out on require (api.js loads this module and only reads `installId`).

const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const { appVersion } = require('./app-version');
const { isUuid } = require('./ipc-guards');

const HEADER = 'X-Dopl-Device';
const STORE_KEY = 'deviceInstallId';
const NAME_MAX = 64;
const OS_VERSION_MAX = 32;
const ARCH_MAX = 16;
const TOKEN_LABEL_MAX = 120;
const NAME_TTL_MS = 10 * 60 * 1000; // ComputerName can be renamed while the app runs
const EXEC_TIMEOUT_MS = 1500;

let store; // undefined = not opened yet; null = unavailable (memory only)
let memoryId = '';
// electron-store re-reads its file on every get, and this is read on every request.
let cachedId = '';
let cachedName = null; // { value, at }

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
  cachedName = null;
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

function run(cmd, args) {
  try {
    return String(execFileSync(cmd, args, { timeout: EXEC_TIMEOUT_MS, encoding: 'utf8' }) || '').trim();
  } catch (_) {
    return '';
  }
}

function friendlyName({ now = Date.now(), platform = process.platform, exec = run, hostname = os.hostname } = {}) {
  if (cachedName && now - cachedName.at < NAME_TTL_MS) return cachedName.value;
  let value = '';
  if (platform === 'darwin') value = clampName(exec('/usr/sbin/scutil', ['--get', 'ComputerName']));
  if (!value) {
    try { value = cleanHostname(hostname()); } catch (_) { value = ''; }
  }
  if (!value) value = 'Computer';
  cachedName = { value, at: now };
  return value;
}

let cachedOsVersion = null;
function osVersion() {
  if (cachedOsVersion !== null) return cachedOsVersion;
  let v = process.platform === 'darwin' ? run('/usr/bin/sw_vers', ['-productVersion']) : '';
  if (!v) {
    try { v = os.release(); } catch (_) { v = ''; }
  }
  cachedOsVersion = String(v || '').slice(0, OS_VERSION_MAX);
  return cachedOsVersion;
}

// The label this machine's CURRENT MCP device token was minted under, so the server can link a
// token minted before this computer registered. Lazy: mcp-config requires api.js, which requires us.
function tokenLabel() {
  try {
    return String(require('./mcp-config').currentDeviceTokenLabel() || '').slice(0, TOKEN_LABEL_MAX);
  } catch (_) {
    return '';
  }
}

function descriptor(status) {
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
  const label = tokenLabel();
  if (label) body.tokenLabel = label;
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
  descriptor,
  deviceHeaders,
  clampName,
  cleanHostname,
  mapPlatform,
  _setStore,
};

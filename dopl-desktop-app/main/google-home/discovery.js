// Finds Google Cast devices (Google Home / Nest speakers, Nest Hubs, Chromecasts, speaker groups)
// on the LAN over mDNS (`_googlecast._tcp.local`). Discovery only: it opens no Cast connection.
// mDNS is `bonjour-service` (MIT, pure JS, no native build) — required lazily so a test or a build
// without it never loads it.

const DEFAULT_TIMEOUT_MS = 3000;

// The `ca` TXT field is a capability bitmask; bit 0 is video out (a screen). Measured on the
// devices pychromecast and Home Assistant document: Nest Hub / Chromecast set it, speakers do not.
const CAP_VIDEO_OUT = 1;
const GROUP_MODEL = 'Google Cast Group';

function txtOf(svc) {
  const raw = svc && svc.txt;
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  return out;
}

function ipv4Of(svc) {
  const list = Array.isArray(svc.addresses) ? svc.addresses : [];
  return list.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || list[0] || svc.host || svc.referer?.address || null;
}

/** One mDNS answer → a Dopl device row, or null when it lacks an address. */
function toDevice(svc) {
  const txt = txtOf(svc);
  const host = ipv4Of(svc);
  if (!host) return null;
  const ca = Number.parseInt(txt.ca, 10);
  const model = txt.md || 'Google Cast device';
  const group = model === GROUP_MODEL;
  return {
    id: txt.id || svc.name || host,
    name: txt.fn || svc.name || host,
    model,
    host,
    port: Number(svc.port) || 8009,
    display: !group && Number.isFinite(ca) && (ca & CAP_VIDEO_OUT) === CAP_VIDEO_OUT,
    group,
  };
}

function defaultBrowserFactory() {
  const { Bonjour } = require('bonjour-service');
  const bonjour = new Bonjour();
  return {
    find: (onUp) => bonjour.find({ type: 'googlecast' }, onUp),
    destroy: () => bonjour.destroy(),
  };
}

/**
 * Browse for `timeoutMs` and return every device seen, de-duplicated by id, speakers before
 * groups, then by name. `browserFactory` is the seam tests replace.
 */
function discoverDevices({ timeoutMs = DEFAULT_TIMEOUT_MS, browserFactory = defaultBrowserFactory } = {}) {
  return new Promise((resolve, reject) => {
    let browser;
    try { browser = browserFactory(); } catch (err) { reject(new Error(`mDNS unavailable: ${err.message}`)); return; }
    const seen = new Map();
    browser.find((svc) => {
      const d = toDevice(svc);
      if (d) seen.set(d.id, d);
    });
    setTimeout(() => {
      try { browser.destroy(); } catch (_) { /* already stopped */ }
      resolve([...seen.values()].sort((a, b) => Number(a.group) - Number(b.group) || a.name.localeCompare(b.name)));
    }, timeoutMs);
  });
}

module.exports = { discoverDevices, toDevice, CAP_VIDEO_OUT };

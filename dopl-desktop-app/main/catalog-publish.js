// THE DESKTOP PUBLISHES ITS LIVE MODEL ROSTER, so the glasses can offer it (2026-10-08).
//
// ⚠ WHY: the glasses menu runs SERVER-side, and the roster is the desktop's alone (each runtime's
// CLI/SDK answers it, `runtime/model-catalog.js`). With nothing stored server-side the lens could
// offer only "Default" plus models already launched. This module sends each runtime's catalog to
// `POST /api/devices/model-catalog` after every LIVE READY read, and re-sends what it holds every
// few hours so the server can tell a running desktop's list from an abandoned one
// (`src/features/model-catalogs/contract.ts › catalogIsStale`).
//
// ⚠ ONE ROW PER COMPUTER on the server: `apiFetch` already sends this install's `X-Dopl-Device`,
// which the route resolves to the caller's registered computer. Nothing here names a device.
//
// ⚠ LABELS AND DIMENSIONS ONLY cross: id, label, short, isDefault, per-model dimension options.
// Never aliases, the launch spelling, the roster key (it is fingerprinted from the sign-in) or
// anything about the machine. Hidden models are not offered and so not sent.
//
// ⚠ NEVER IN THE WAY: fire-and-forget, one request per runtime at a time, failures are a diag line
// and a retry on the next tick. A server without the table answers `{ stored: false }`
// (migration unapplied) and is simply retried later.

const { apiFetch } = require('./api');
const appVersion = require('./app-version');
const modelCatalog = require('./runtime/model-catalog');
const { diag } = require('./diag');

const ENDPOINT = '/api/devices/model-catalog';
const HTTP_TIMEOUT_MS = 10000;
const RETRY_SOON_MS = 2 * 60 * 1000;

// ─── BEGIN CATALOG-PUBLISH-PURE (unit-tested via source extraction) ──────────
// No electron/require refs below.

/** Re-send an unchanged catalog this often: the server reads silence as staleness. */
const REPUBLISH_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;
const MAX_MODELS = 100;

const clip = (v, n) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, n) : null;
};

/**
 * A catalog → the wire body, or null when there is nothing to offer. The server's schema is the
 * fence; this shapes to it so a valid catalog is never refused for a long label.
 */
function publishableCatalog(runtimeId, catalog, version) {
  if (!catalog || !Array.isArray(catalog.models)) return null;
  const models = [];
  for (const m of catalog.models) {
    if (!m || m.hidden === true) continue;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id || id.length > 100 || /\s/.test(id) || models.some((x) => x.id === id)) continue;
    const dimensions = {};
    for (const [key, d] of Object.entries(m.dimensions || {})) {
      const k = clip(key, 32);
      const options = (Array.isArray(d && d.options) ? d.options : [])
        .map((o) => ({ value: clip(o && o.value, 40), label: clip(o && o.label, 60) || clip(o && o.value, 60) }))
        .filter((o) => o.value)
        .slice(0, 12);
      if (!k || !options.length) continue;
      dimensions[k] = { options, default: options.some((o) => o.value === d.default) ? d.default : null };
    }
    models.push({
      id,
      label: clip(m.label, 80),
      short: clip(m.short, 80),
      isDefault: m.isDefault === true,
      dimensions,
    });
    if (models.length >= MAX_MODELS) break;
  }
  if (!models.length) return null;
  const body = { runtime: runtimeId, models };
  const v = clip(version, 32);
  if (v) body.appVersion = v;
  return body;
}

/** Should `held` be sent now? A changed list always; an unchanged one once it has aged. */
function due(held, nowMs) {
  if (!held || held.sending) return false;
  if (held.sentSig !== held.sig) return true;
  return nowMs - held.sentAt >= REPUBLISH_MS;
}

// ─── END CATALOG-PUBLISH-PURE ────────────────────────────────────────────────

/** runtimeId → { body, sig, sentSig, sentAt, sending } */
const held = new Map();
let timer = null;

async function send(runtimeId) {
  const h = held.get(runtimeId);
  if (!due(h, Date.now())) return;
  h.sending = true;
  const sig = h.sig;
  try {
    const res = await apiFetch(ENDPOINT, { method: 'POST', body: h.body, timeoutMs: HTTP_TIMEOUT_MS, noStore: true });
    if (!res.ok) {
      diag('catalog publish:', runtimeId, 'HTTP', res.status);
      return;
    }
    const out = await res.json().catch(() => null);
    if (out && out.stored === true) {
      h.sentSig = sig;
      h.sentAt = Date.now();
    } else {
      // Table not applied yet, or this computer not registered yet (the heartbeat registers it
      // shortly after launch): try once more soon, then the hourly tick carries on.
      diag('catalog publish:', runtimeId, 'not stored —', (out && out.reason) || 'server table absent?');
      if (!h.retrySoon) {
        h.retrySoon = setTimeout(() => { h.retrySoon = null; void send(runtimeId); }, RETRY_SOON_MS);
        if (typeof h.retrySoon.unref === 'function') h.retrySoon.unref();
      }
    }
  } catch (err) {
    diag('catalog publish:', runtimeId, 'failed —', (err && err.message) || String(err));
  } finally {
    h.sending = false;
  }
}

function hold(runtimeId, catalog) {
  const body = publishableCatalog(runtimeId, catalog, appVersion.appVersion());
  if (!body) {
    held.delete(runtimeId);
    return;
  }
  const sig = JSON.stringify(body.models);
  const prior = held.get(runtimeId);
  held.set(runtimeId, prior ? Object.assign(prior, { body, sig }) : { body, sig, sentSig: null, sentAt: 0, sending: false });
  void send(runtimeId);
}

function start() {
  if (timer) return;
  modelCatalog.onLiveReady(hold);
  // A runtime that stops being ready stops being re-sent: its row ages into "stale" on the server.
  modelCatalog.onSettled((runtimeId, _from, to) => {
    if (to !== 'ready') held.delete(runtimeId);
  });
  timer = setInterval(() => {
    for (const id of held.keys()) void send(id);
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { start, publishableCatalog };

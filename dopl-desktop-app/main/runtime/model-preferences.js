// THE OPERATOR'S DEFAULT-MODEL PREFERENCE — DATA, NOT CODE (2026-10-08, Samuel's "I think we should do
// Sol", kept as a SETTING). A runtime may have a preferred model FAMILY (`sol`); a no-pick launch runs the
// NEWEST model in that family the live roster offers, so a new release (`gpt-7-sol`) is picked up with no
// Dopl change. No family member on the roster → nothing preferred: the runtime's own default runs. A
// preference is never a refusal.
//
// Seeded from `model-preferences.seed.json`; the operator's stored value (electron-store, local only)
// overrides the seed, and `null` stored means "no preference". Nothing here names a model id.

const SEED = require('./model-preferences.seed.json');

const str = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const FAMILY_RE = /^[a-z][a-z0-9]{0,23}$/;
const STORE_KEY = 'runtimeModelFamily';

let store = null;
function storeOf() {
  if (store) return store;
  // Lazy: electron-free harnesses read the seed only.
  const Store = require('electron-store');
  store = new Store();
  return store;
}

/** The preferred family for `runtimeId` (stored, else seeded), or '' for none. Never throws. */
function familyFor(runtimeId) {
  const id = str(runtimeId);
  let stored;
  try {
    const map = storeOf().get(STORE_KEY);
    stored = map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined;
  } catch (_) { stored = undefined; }
  if (stored === null) return '';
  const v = str(stored !== undefined ? stored : (SEED[id] && SEED[id].family));
  return FAMILY_RE.test(v) ? v : '';
}

/** Set (or clear with null) the preferred family for `runtimeId`. False on a value outside the alphabet. */
function setFamily(runtimeId, family) {
  const id = str(runtimeId);
  const v = family === null ? null : str(family);
  if (!id || (v !== null && !FAMILY_RE.test(v))) return false;
  const map = Object.assign({}, storeOf().get(STORE_KEY) || {});
  map[id] = v;
  storeOf().set(STORE_KEY, map);
  return true;
}

// `gpt-5.6-sol` → tokens ['gpt','5','6','sol']: the family is a whole token, never a substring.
const tokens = (id) => String(id || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const versionOf = (id, family) => {
  const t = tokens(id);
  const nums = t.slice(0, t.indexOf(family)).filter((x) => /^\d+$/.test(x)).map(Number);
  return nums;
};
function newer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

/** PURE: the newest offered (non-hidden) model whose id carries `family` as a token, or null. Ties keep
 *  the roster's own order. */
function pickFamily(models, family) {
  const f = str(family);
  if (!f) return null;
  let best = null;
  for (const m of Array.isArray(models) ? models : []) {
    if (!m || m.hidden || tokens(m.id).indexOf(f) === -1) continue;
    if (!best || newer(versionOf(m.id, f), versionOf(best.id, f))) best = m;
  }
  return best;
}

/** The preferred model on `runtimeId` among `models`, or null. */
function preferredModel(runtimeId, models) {
  return pickFamily(models, familyFor(runtimeId));
}

/** Tests only. */
function inject(next) { store = next || null; }

module.exports = { familyFor, setFamily, pickFamily, preferredModel, inject, STORE_KEY };

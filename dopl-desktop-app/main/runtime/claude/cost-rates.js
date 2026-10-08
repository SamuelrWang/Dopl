// WHAT EACH MODEL HAS ACTUALLY COST ON THIS MAC (2026-10-08, cross-review M2) — learned, never typed.
// The CLI prices every turn itself (`result.modelUsage[id].costUSD`, alongside the tokens it counted), so
// Dopl learns a blended rate per model id from real turns and can pick the CHEAPEST model the operator's
// own account has run, e.g. for the updater's live safety probe (`update-source.js › verifySemantics`).
// No price is written here, and no model id: with nothing learned yet, the answer is "none" (the CLI's
// own default runs). Persisted in the shared last-live store (`live-store.js`, kind `rates`).

const { readCount } = require('../sdk-shape');

const KEY = 'all'; // rates are a property of the account's models, not of one CLI build
const rates = new Map(); // id → { usd, tokens }
let loaded = false;

function store() { return require('../live-store'); }

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = store().read('rates', 'claude', KEY);
    if (saved && typeof saved === 'object') {
      for (const [id, r] of Object.entries(saved)) {
        const usd = readCount(r, 'usd');
        const tokens = readCount(r, 'tokens');
        if (usd && tokens) rates.set(id, { usd, tokens });
      }
    }
  } catch (_) { /* a missing or unreadable store is "nothing learned" */ }
}

/** Fold one `result.modelUsage` block in. Never throws; a block without price or tokens teaches nothing. */
function learn(modelUsage) {
  load();
  let changed = false;
  for (const [id, u] of Object.entries(modelUsage && typeof modelUsage === 'object' ? modelUsage : {})) {
    const usd = readCount(u, 'costUSD');
    const tokens = (readCount(u, 'inputTokens') || 0) + (readCount(u, 'outputTokens') || 0)
      + (readCount(u, 'cacheReadInputTokens') || 0) + (readCount(u, 'cacheCreationInputTokens') || 0);
    if (!usd || !tokens) continue;
    const prior = rates.get(id) || { usd: 0, tokens: 0 };
    rates.set(id, { usd: prior.usd + usd, tokens: prior.tokens + tokens });
    changed = true;
  }
  if (changed) {
    try { store().save('rates', 'claude', KEY, Object.fromEntries(rates)); } catch (_) { /* best effort */ }
  }
}

/** The id among `ids` with the lowest learned cost per token, or null when none has been seen to cost. */
function cheapest(ids) {
  load();
  let best = null;
  let bestRate = Infinity;
  for (const id of Array.isArray(ids) ? ids : []) {
    const r = rates.get(id);
    if (!r) continue;
    const rate = r.usd / r.tokens;
    if (rate < bestRate) { best = id; bestRate = rate; }
  }
  return best;
}

/** Tests only. */
function reset() { rates.clear(); loaded = true; }

module.exports = { learn, cheapest, reset };

// THE LIVE CLAUDE MODEL ROSTER — `Query.supportedModels()` read WITHOUT spending a turn: the CLI is
// started with a streaming prompt that never yields, so only the `initialize` handshake runs (zero
// API requests), under the same pins a launch carries. Signed out, the Fable row is absent — the
// roster is per account. Pure below `probe`.

const { findModel } = require('../model-catalog');

const PROBE_TIMEOUT_MS = 10000;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The plainest spelling (no `[1m]`, no `-YYYYMMDD`) — for matching only, never for launching. */
function baseId(id) {
  return str(id).replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

/** A glance word: the display name without a trailing parenthetical ("Opus (1M context)" → "Opus"). */
function shortOf(label) {
  if (!label) return null;
  return label.replace(/\s*\([^)]*\)\s*$/, '') || label;
}

/**
 * One `ModelInfo` row → one catalog entry, or `null`. The catalog id is `resolvedModel` and the launch
 * argument is `value`; the CLI's `'default'` row is dropped (Samuel removed Default). `legacy` (the
 * build's id→alias table) only adds aliases, so older stored picks still find their row.
 */
function entryFrom(row, legacy) {
  if (!row || typeof row !== 'object') return null;
  const value = str(row.value);
  if (!value || value === 'default') return null;
  const resolved = str(row.resolvedModel);
  const id = resolved || value;
  const label = str(row.displayName) || null;
  const aliases = [];
  const add = (v) => { const s = str(v); if (s && s !== id && aliases.indexOf(s) === -1) aliases.push(s); };
  add(value);
  add(resolved);
  add(baseId(id));
  for (const oldId of Object.keys(legacy || {})) {
    if (baseId(oldId) !== baseId(id)) continue;
    add(oldId);
    add(legacy[oldId]);
  }
  return { id, value, label, short: shortOf(label), isDefault: false, hidden: false, aliases, dimensions: {} };
}

/** The row a pick names EXACTLY — its id, then any alias. What a LAUNCH resolves by (RC-01). */
function matchExact(models, pick) {
  return Array.isArray(models) ? findModel({ models }, pick) : null;
}

/** For labelling and the default marker: exact, then the same model under its base spelling. */
function match(models, pick) {
  const v = str(pick);
  if (!v || !Array.isArray(models)) return null;
  return matchExact(models, v)
    || models.find((m) => baseId(m.id) === baseId(v))
    || null;
}

/**
 * `supportedModels()` rows → the adapter's roster, in the CLI's order. The default marker lands on
 * the row that is `fallbackId`, else the row now carrying its alias (a newer Sonnet keeps `sonnet`).
 */
function rosterFrom(rows, opts) {
  const o = opts || {};
  const models = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const entry = entryFrom(row, o.legacy);
    if (entry && !models.some((m) => m.id === entry.id)) models.push(entry);
  }
  if (!models.length) {
    return { source: 'live', key: o.key || null, ids: [], models: [], defaultId: null,
      reason: 'Claude Code answered with no models Dopl could read.', truncated: false };
  }
  const def = match(models, o.fallbackId) || match(models, o.fallbackAlias);
  if (def) def.isDefault = true;
  return {
    source: 'live',
    key: o.key || null,
    ids: models.map((m) => m.id),
    models,
    defaultId: def ? def.id : null,
    reason: '',
    truncated: false,
  };
}

/** Start the CLI, read its model list, stop it — never a turn. `o.sdk` is the loaded namespace,
 *  `o.options` the spawn env/binary. Resolves to the raw rows or rejects with a readable reason. */
async function probe(o) {
  const sdk = o && o.sdk;
  if (!sdk || typeof sdk.query !== 'function') throw new Error('the Claude Agent SDK could not be loaded');
  let release = () => {};
  const idle = new Promise((resolve) => { release = resolve; });
  async function* prompt() { await idle; } // yields nothing: no user message, so no model turn
  const q = sdk.query({
    prompt: prompt(),
    // The caller's options (env, binary) first and the pins last, so no caller can lift a pin.
    options: Object.assign({}, (o && o.options) || {}, {
      settingSources: [],
      permissionMode: 'default',
      mcpServers: {},
      tools: [],
      // No `maxTurns`: no turn can start, and `launch-spec.js` is its one producer.
      canUseTool: async () => ({ behavior: 'deny', message: 'model roster probe' }),
    }),
  });
  // Drained in the background so an early exit rejects here rather than going unhandled.
  const drained = (async () => { try { for await (const _m of q) { /* nothing arrives */ } } catch (_) { /* reported below */ } })();
  const timeoutMs = (o && o.timeoutMs) || PROBE_TIMEOUT_MS;
  let timer = null;
  try {
    return await Promise.race([
      q.supportedModels(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Claude Code did not list its models within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    // Always: close the child and release the idle prompt, whatever the race answered.
    if (timer) clearTimeout(timer);
    try { q.close(); } catch (_) { /* best effort */ }
    release();
    void drained;
  }
}

module.exports = { probe, rosterFrom, match, matchExact, baseId };

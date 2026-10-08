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

/** A row the CLI lists under a full model id (`claude-opus-4-8`) rather than an alias (`opus`). */
function isPinned(value) {
  return /^claude-/.test(str(value));
}

/** `claude-<family>-<n>[-<n>…]` → `{ family, version: [n…] }`, or `null` for any other shape. */
function familyOf(id) {
  const m = /^claude-([a-z]+)((?:-\d+)+)$/.exec(baseId(id));
  return m ? { family: m[1], version: m[2].slice(1).split('-').map(Number) } : null;
}

function olderThan(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * One `ModelInfo` row → one catalog entry, or `null`. The catalog id is `resolvedModel` and the launch
 * argument is `value`; the CLI's `'default'` row is dropped (Samuel removed Default). `legacy` (the
 * build's id→alias table) only adds aliases to ALIAS rows, so older stored picks find the current row
 * and a pinned older model never claims `opus`/`sonnet`.
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
  // An alias row also answers to its bare word (`opus[1m]` → `opus`), so a parked `opus` pick finds it.
  if (!isPinned(value)) add(value.replace(/\[[^\]]*\]$/, ''));
  add(resolved);
  add(baseId(id));
  for (const oldId of Object.keys(isPinned(value) ? {} : (legacy || {}))) {
    if (baseId(oldId) !== baseId(id)) continue;
    add(oldId);
    add(legacy[oldId]);
  }
  // `launch` is the runtime's own argv value for the row (`model-catalog.js` keeps it, so a launch resolves
  // off the one cache); `value` stays for this module's readers.
  return { id, value, launch: value, label, short: shortOf(label), isDefault: false, hidden: false, aliases, dimensions: {} };
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
 * Hide the CLI's "older models" (2026-10-08, Samuel): a PINNED row whose family also has an ALIAS row
 * of a newer version (`claude-opus-4-8` beside `opus` → `claude-opus-5-5`). Hidden, not dropped, so a
 * stored or resumed pick still resolves and labels. A pinned row with no alias in its family, or newer
 * than the alias, stays offered.
 */
function hideSuperseded(models) {
  const current = {};
  for (const m of models) {
    if (isPinned(m.value)) continue;
    const f = familyOf(m.id);
    if (f && (!current[f.family] || olderThan(current[f.family], f.version))) current[f.family] = f.version;
  }
  for (const m of models) {
    if (!isPinned(m.value)) continue;
    const f = familyOf(m.id);
    if (f && current[f.family] && olderThan(f.version, current[f.family])) m.hidden = true;
  }
}

/**
 * `supportedModels()` rows → the adapter's roster, in the CLI's order. The default marker lands on
 * the row that is `fallbackId`, else the row now carrying its alias (a newer Sonnet keeps `sonnet`);
 * never on a hidden row.
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
  hideSuperseded(models);
  const visible = (m) => (m && !m.hidden ? m : null);
  // The CLI's OWN default (its `default` row names the model it runs with no pick) marks the default;
  // the caller's fallbacks only apply to a CLI that sends no such row.
  const defRow = (Array.isArray(rows) ? rows : []).find((r) => r && str(r.value) === 'default');
  const cliDefault = defRow ? str(defRow.resolvedModel) : '';
  // ⚠ NEVER CLAIM A MODEL A NO-PICK LAUNCH WILL NOT RUN (2026-10-08). The `default` row marks the default
  // only when the CLI's live no-pick model (`o.liveDefault`) is the same model; when they disagree, or the
  // live model is unknown, nothing is marked and the picker reads a neutral "Default".
  const agrees = !!cliDefault && !!str(o.liveDefault) && baseId(cliDefault) === baseId(o.liveDefault);
  const def = (agrees && visible(match(models, cliDefault)))
    || visible(match(models, o.fallbackId)) || visible(match(models, o.fallbackAlias));
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

/**
 * Start the CLI with a prompt that never yields (only the `initialize` handshake runs: zero API
 * requests, no model turn), run `fn(q, sdk)` against the open query, stop it. `o.sdk` is the loaded
 * namespace, `o.options` the spawn env/binary (the pins below are applied last, so no caller lifts one).
 */
async function withIdleQuery(o, what, fn) {
  const sdk = o && o.sdk;
  if (!sdk || typeof sdk.query !== 'function') throw new Error('the Claude Agent SDK could not be loaded');
  let release = () => {};
  const idle = new Promise((resolve) => { release = resolve; });
  async function* prompt() { await idle; } // yields nothing: no user message, so no model turn
  const q = sdk.query({
    prompt: prompt(),
    options: Object.assign({}, (o && o.options) || {}, {
      settingSources: [],
      permissionMode: 'default',
      mcpServers: {},
      tools: [],
      // No `maxTurns`: no turn can start, and `launch-spec.js` is its one producer.
      canUseTool: async () => ({ behavior: 'deny', message: 'turn-free probe' }),
    }),
  });
  // Drained in the background so an early exit rejects here rather than going unhandled.
  const drained = (async () => { try { for await (const _m of q) { /* nothing arrives */ } } catch (_) { /* reported below */ } })();
  const timeoutMs = (o && o.timeoutMs) || PROBE_TIMEOUT_MS;
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(q, sdk)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Claude Code did not ${what} within ${timeoutMs}ms`)), timeoutMs);
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

/**
 * `{ rows, liveModel }`, or a rejection with a readable reason. Never a turn. `rows` are the raw
 * `supportedModels()` rows; `liveModel` is the model this CLI ACTUALLY runs with no pick, from its own
 * `getContextUsage()` answer on the same handshake (null when it does not answer). The two can disagree
 * (measured 2026-10-08: the `default` row named one model while a no-pick launch ran another), and only
 * the second is true of a launch.
 */
function probe(o) {
  return withIdleQuery(o, 'list its models', async (q) => {
    const rows = await q.supportedModels();
    let liveModel = null;
    try {
      const u = typeof q.getContextUsage === 'function' ? await q.getContextUsage() : null;
      liveModel = u && typeof u.model === 'string' && u.model.trim() ? u.model.trim() : null;
    } catch (_) { liveModel = null; }
    return { rows, liveModel };
  });
}

/** Every function name a live Query answers to (own and inherited), constructor excluded. */
function methodsOf(q) {
  const out = new Set();
  for (let p = q; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (k === 'constructor') continue;
      try { if (typeof q[k] === 'function') out.add(k); } catch (_) { /* a getter that throws is not a method */ }
    }
  }
  return Array.from(out);
}

/**
 * THE PAIRING'S OWN DESCRIPTION OF ITSELF (`sdk-shape.js` Shape), read live and turn-free: the SDK
 * namespace's exports, the methods its Query answers to, and the fields the CLI's `supportedModels`
 * rows carry. This is what `descriptor.requiredShape` is checked against, at launch and on an update.
 */
function observeShape(o) {
  return withIdleQuery(o, 'describe itself', async (q, sdk) => {
    const rows = await q.supportedModels();
    const fields = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== 'object') continue;
      for (const [k, v] of Object.entries(row)) if (v !== undefined && v !== null) fields.add(k);
    }
    return {
      exports: Object.keys(sdk).filter((k) => typeof sdk[k] === 'function'),
      methods: methodsOf(q),
      results: { supportedModels: Array.from(fields) },
    };
  });
}

module.exports = { probe, observeShape, rosterFrom, match, matchExact, baseId, isPinned };

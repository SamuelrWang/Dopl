// THE LIVE CLAUDE MODEL ROSTER — `Query.supportedModels()`, read WITHOUT SPENDING A TURN
// (2026-09-22, Samuel: *"can we make sure the models aren't hard coded? … if claude or codex add a
// new model, would dopl auto mark those as options"*).
//
// ⚠ **HOW IT IS READ, AND WHY IT COSTS NO MODEL TURN (MEASURED 2026-09-22, SDK 0.3.220 / bundled
// CLI on this Mac).** `query()` is started with a STREAMING prompt that never yields. The SDK
// spawns the bundled CLI and sends only the `initialize` control request; `supportedModels()`
// answers from that handshake, and `close()` ends the child. No user message is ever pushed, so
// no API request is made: the probe saw ZERO SDK messages, in ~1.3s signed in and ~0.3s signed out.
// ⚠ IT IS NOT A SESSION. No MCP server, no tools, no setting sources, a deny-everything gate —
// the same pins a real launch carries, so a roster read cannot pick up the operator's own config.
//
// ⚠ **WHAT IT ANSWERS (MEASURED, signed in on a Max account):**
//   value 'default'            resolvedModel claude-opus-5[1m]           "Default (recommended)"
//   value 'opus[1m]'           resolvedModel claude-opus-5[1m]           "Opus (1M context)"
//   value 'claude-fable-5[1m]' resolvedModel claude-fable-5              "Fable"
//   value 'sonnet'             resolvedModel claude-sonnet-5             "Sonnet"
//   value 'haiku'              resolvedModel claude-haiku-4-5-20251001   "Haiku"
// Signed OUT the Fable row is absent — THE ROSTER IS PER ACCOUNT, which is why the cache key in
// `models.js` includes the credential source.
//
// ⚠ **THE CATALOG ID IS `resolvedModel`, AND THE LAUNCH ARGUMENT IS `value`.** Samuel's 2026-08-22
// ruling names the values an operator picks as FULL IDS, and `resolvedModel` is the SDK's own
// "canonical wire model id this row's value resolves to". `value` is what `--model` accepts for
// that row, so a pick launches as exactly the model the row describes.
// ⚠ `'default'` IS NOT A MODEL, it is the CLI's own pick pointing at another row, and Samuel
// removed "Default" as an option on 2026-09-06 — so it is dropped here rather than offered.
//
// PURE BELOW THE PROBE: `rosterFrom` / `match` / `baseId` take data and return data, so the suite
// drives them without an SDK.

const PROBE_TIMEOUT_MS = 10000;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The same model under its plainest spelling: no `[1m]` long-context suffix, no `-YYYYMMDD` date.
 * ⚠ FOR MATCHING ONLY, never for launching — `claude-opus-5` and `claude-opus-5[1m]` may be two
 * rows one day, and the launch argument always comes off the row that matched.
 */
function baseId(id) {
  return str(id).replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

/** A glance word: the display name without a trailing parenthetical ("Opus (1M context)" → "Opus"). */
function shortOf(label) {
  if (!label) return null;
  return label.replace(/\s*\([^)]*\)\s*$/, '') || label;
}

/**
 * One `ModelInfo` row → one catalog entry, or `null`.
 *
 * ⚠ `legacy` IS THE FROZEN id→alias TABLE, and it only ever ADDS SPELLINGS. A channel stored
 * `claude-opus-5` and a parked session stored `opus` before this roster existed; both must still
 * find the row that is that model today. They are aliases — never ids, never offered.
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
  const v = str(pick);
  if (!v || !Array.isArray(models)) return null;
  return models.find((m) => m.id === v)
    || models.find((m) => Array.isArray(m.aliases) && m.aliases.indexOf(v) !== -1)
    || null;
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
 * `supportedModels()` rows → the adapter's roster. ⚠ ORDER IS THE CLI'S, UNTOUCHED.
 * `fallback` is the PRODUCT's default id (`session-model.js › LAUNCH_MODEL_FALLBACK`) and its
 * alias: the default marker lands on the row that is that model, or on the row that now carries
 * its alias (the day a newer Sonnet ships, `sonnet` still names "the Sonnet").
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

/**
 * Start the CLI, read its model list, stop it. ⚠ NEVER A TURN — see the header.
 * `o.sdk` is the loaded SDK namespace; `o.options` the spawn pins (env, binary). Resolves to the
 * raw rows or rejects with an operator-readable reason.
 */
async function probe(o) {
  const sdk = o && o.sdk;
  if (!sdk || typeof sdk.query !== 'function') throw new Error('the Claude Agent SDK could not be loaded');
  let release = () => {};
  const idle = new Promise((resolve) => { release = resolve; });
  async function* prompt() { await idle; } // yields nothing: no user message, so no model turn
  const q = sdk.query({
    prompt: prompt(),
    options: Object.assign({
      settingSources: [],
      permissionMode: 'default',
      mcpServers: {},
      tools: [],
      // ⚠ NO `maxTurns`: this is not a session and no turn can start (nothing is ever pushed), and
      // `launch-spec.js › SESSION_MAX_TURNS` is pinned as the ONE producer of that option.
      canUseTool: async () => ({ behavior: 'deny', message: 'model roster probe' }),
    }, (o && o.options) || {}),
  });
  // ⚠ DRAINED IN THE BACKGROUND so an early exit surfaces as a rejection here, not as an
  // unhandled one. Nothing is expected on it.
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
    if (timer) clearTimeout(timer);
    try { q.close(); } catch (_) { /* best effort */ }
    release();
    void drained;
  }
}

module.exports = { probe, rosterFrom, entryFrom, match, matchExact, baseId, shortOf, PROBE_TIMEOUT_MS };

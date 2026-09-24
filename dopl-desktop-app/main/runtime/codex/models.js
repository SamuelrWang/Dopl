// Codex's live model roster: `model/list` (with each model's reasoning efforts) from a short-lived
// app-server of its own, in the isolated CODEX_HOME so a picker never loads user config. Bounded, never
// throws into a picker; a failure carries a `reason` (`model-catalog.js`: `unavailable`, not "no models").

const client = require('./client');
const configHome = require('./config-home');
const cliSpawn = require('../cli-spawn');

const LIST_TIMEOUT_MS = 8000;

// Bounds the cursor loop; hitting it reports `truncated` rather than a complete list.
const MAX_PAGES = 10;

// Codex's own `model_reasoning_effort` values: what Dopl can STORE; `model/list` says what each model offers.
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const DIMENSION = 'reasoningEffort';

let cached = null; // { key, roster }

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** `model/list` answers `{ data, nextCursor }` (measured, codex-cli 0.155.1). */
function rowsFrom(result) {
  return result && Array.isArray(result.data) ? result.data : [];
}

/** One `model/list` row (field names measured on codex-cli 0.155.1) → one catalog entry, or null. */
function entryFrom(row) {
  if (!row || typeof row !== 'object') return null;
  const id = str(row.id);
  if (!id) return null;
  const label = str(row.displayName) || null;
  const isDefault = row.isDefault === true;
  const hidden = row.hidden === true;
  const supported = effortsFrom(row);
  const dimensions = {};
  if (supported.options.length) {
    dimensions[DIMENSION] = {
      options: supported.options,
      default: supported.options.some((o) => o.value === supported.fallback) ? supported.fallback : null,
    };
  }
  return { id, label, short: label, isDefault, hidden, dimensions };
}

/** `supportedReasoningEfforts` → `{ options: [{value,label,description}], fallback }`. */
function effortsFrom(row) {
  const raw = row.supportedReasoningEfforts;
  const options = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = str(item && item.reasoningEffort);
    // Only storable efforts are offered: an unstorable option is a control that writes nowhere (F-390).
    if (!value || REASONING_EFFORTS.indexOf(value) === -1) continue;
    if (options.some((o) => o.value === value)) continue;
    options.push({
      value,
      label: value,
      description: str(item.description) || null,
    });
  }
  return {
    options,
    fallback: str(row.defaultReasoningEffort),
  };
}

/** `<resolved path>@<version>`: a repointed binary or an upgraded CLI re-reads. */
function cacheKey(gate) {
  return `${str(gate && gate.path) || '?'}@${str(gate && gate.version) || '?'}`;
}

function failure(key, reason) {
  return { source: 'live', key, ids: [], models: [], defaultId: null, reason, truncated: false };
}

// Paginates with `cursor` (measured `ModelListParams`). `includeHidden` and `limit` are deliberately
// not sent: the server's default withholds hidden models and picks the page size.
async function listPages(conn) {
  const rows = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = cursor ? { cursor } : {};
    const result = await conn.request('model/list', params);
    rows.push(...rowsFrom(result));
    const next = str(result && result.nextCursor);
    // `truncated` = Dopl stopped (a repeated cursor, or the page cap), not the server running out.
    if (!next) return { rows, truncated: false };
    if (next === cursor) return { rows, truncated: true };
    cursor = next;
  }
  return { rows, truncated: true };
}

/** Takes the caller's probe: calling `probe()` again would be a second `--version` spawn. */
async function fetchRoster(gate) {
  const key = cacheKey(gate);
  if (!gate || !gate.ok) return failure(key, (gate && gate.reason) || 'Dopl could not reach the Codex CLI.');
  return new Promise((resolve) => {
    let conn = null;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { if (conn) conn.close(); } catch (_) { /* best effort */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(failure(key,
      `\`${str(gate.path) || 'codex'} app-server\` did not answer \`model/list\` within ${LIST_TIMEOUT_MS}ms.`)),
    LIST_TIMEOUT_MS);
    try {
      conn = client.connect({ args: [], env: configHome.isolatedEnv(cliSpawn.scrubbedEnv(process.env)) });
      conn.request('initialize', client.initializeParams(appVersion()))
        .then(() => { conn.notify('initialized'); return listPages(conn); })
        .then(({ rows, truncated }) => {
          clearTimeout(timer);
          finish(rosterFrom(key, rows, truncated));
        })
        .catch((err) => {
          clearTimeout(timer);
          finish(failure(key, (err && err.message) || 'Codex refused `model/list`.'));
        });
    } catch (err) {
      clearTimeout(timer);
      finish(failure(key, (err && err.message) || 'Dopl could not start `codex app-server`.'));
    }
  });
}

// Server order, untouched. Hidden models are carried (a session on one must still be labelled;
// `model-catalog.js` stops them being offered). Not exactly one default is reported, not tie-broken.
function rosterFrom(key, rows, truncated) {
  const models = [];
  for (const row of rows) {
    const entry = entryFrom(row);
    if (entry && !models.some((m) => m.id === entry.id)) models.push(entry);
  }
  if (!models.length) {
    return failure(key, 'Codex answered `model/list` with no models Dopl could read.');
  }
  const defaults = models.filter((m) => m.isDefault);
  const ids = models.map((m) => m.id);
  return {
    source: 'live',
    key,
    ids,
    models,
    defaultId: defaults.length === 1 ? defaults[0].id : null,
    // A roster with no single default is still a roster: the models are real and pickable.
    reason: defaults.length === 1 ? ''
      : `Codex's model list is unusual: it declares ${defaults.length} defaults; exactly one is expected.`,
    truncated: truncated === true,
  };
}

const appVersion = () => require('../../app-version').appVersion();

// Cached by `<path>@<version>`; a failed read is not (retry: `model-catalog.js › FAILURE_TTL_MS`), and
// `resolve-bin.js` caches only a hit, so an install made with Dopl open is picked up.
async function models() {
  const gate = await client.probe();
  const key = cacheKey(gate);
  if (cached && cached.key === key) return cached.roster;
  const roster = await fetchRoster(gate);
  // `models.length`, not `reason`: a complete roster can still carry a sentence (odd default, truncated).
  if (roster.models.length) cached = { key: roster.key || key, roster };
  return roster;
}

/** Drop the cache (tests; an explicit re-probe). */
function forget() { cached = null; }

const descriptor = {
  source: 'live',
  // Declaring it is what renders the effort control; never `[]` (an empty control instead of none).
  dimensions: [DIMENSION],
  // A no-pick launch's model, spent only when a READY live catalog offers it, else no model is sent
  // (`runtime/launch-default.js`). A preference, never a refusal.
  launchDefault: 'gpt-6-sol',
  // Shape check only: storage cannot call the live roster; the live catalog narrows NEW picks
  // (`lib/model-catalog.ts › selectableModels`). Still a gate: the value becomes `thread/start.model`.
  pick: {
    absent: '', // no `model` field at all: the platform's own pick
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$',
  },
  // What makes the effort storable (`contract.js › descriptorProblems`). `fallback: 'absent'` drops an
  // unrecognised effort (no field, the platform picks): not containment, so nothing to floor to.
  dimensionOptions: {
    reasoningEffort: { options: REASONING_EFFORTS.slice(), default: null, fallback: 'absent' },
  },
};

module.exports = {
  models, forget, descriptor, entryFrom, rosterFrom, cacheKey,
  DIMENSION, LIST_TIMEOUT_MS, MAX_PAGES,
};

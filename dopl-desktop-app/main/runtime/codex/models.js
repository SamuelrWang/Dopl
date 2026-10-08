// Codex's live model roster: `model/list` (with each model's reasoning efforts) from a short-lived
// app-server of its own, in the isolated CODEX_HOME so a picker never loads user config. Bounded, never
// throws into a picker; a failure carries a `reason` (`model-catalog.js`: `unavailable`, not "no models").

const client = require('./client');
const configHome = require('./config-home');
const cliSpawn = require('../cli-spawn');

const LIST_TIMEOUT_MS = 8000;

// Bounds the cursor loop; hitting it reports `truncated` rather than a complete list.
const MAX_PAGES = 10;

// NO EFFORT LIST (2026-10-08): `model/list` says what each model offers, and that is what is offered —
// a new level upstream appears with no Dopl change. What makes a value STORABLE is its alphabet (it
// becomes `turn/start.effort`), and whether it is OFFERED is the live catalog's question at launch.
const EFFORT_PATTERN = '^[a-z][a-z0-9_-]{0,31}$';
const EFFORT_RE = new RegExp(EFFORT_PATTERN);

const DIMENSION = 'reasoningEffort';

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
    // A value outside the storable alphabet is not offered (it could not be sent); anything else the
    // server lists is, so a new level needs no Dopl release.
    if (!value || !EFFORT_RE.test(value)) continue;
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
      // PINNED to the binary the probe checked (Codex self-audit M1): never a re-resolve an update could move.
      conn = client.connect({ bin: gate.path, args: [], env: configHome.isolatedEnv(cliSpawn.scrubbedEnv(process.env)) });
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

// ALWAYS LIVE: the one roster cache is the shared catalog's (`../model-catalog.js`, keyed by the build key
// and persisted there). `resolve-bin.js` caches only a hit, so an install made with Dopl open is picked up.
async function models() {
  // A downloaded binary that cannot answer `--version` at the floor is rejected inside the probe, which then
  // answers for what launches run instead. Only the probe: `model/list` can fail on the network or the
  // account, which says nothing of the build.
  return fetchRoster(await client.probe());
}

const descriptor = {
  source: 'live',
  // Declaring it is what renders the effort control; never `[]` (an empty control instead of none).
  dimensions: [DIMENSION],
  // NO launchDefault here: the operator's preferred FAMILY ("sol", Samuel 2026-10-08) is a SETTING
  // (`../model-preferences.js`, seeded by `model-preferences.seed.json`) resolved against the live roster —
  // the newest family member runs, a new release needs no Dopl change, and no member means Codex's own default.
  // Shape check only: storage cannot call the live roster; the live catalog narrows NEW picks
  // (`lib/model-catalog.ts › selectableModels`). Still a gate: the value becomes `thread/start.model`.
  pick: {
    absent: '', // no `model` field at all: the platform's own pick
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$',
  },
  // `live`: the options are each model's own (`model/list`), so storage checks the ALPHABET and a launch
  // checks the live catalog (`contract.js › selectionProblems`). `fallback: 'absent'` drops a value the
  // model does not offer (no field, the platform picks): not containment, so nothing to floor to.
  dimensionOptions: {
    reasoningEffort: { live: true, pattern: EFFORT_PATTERN, default: null, fallback: 'absent' },
  },
};

module.exports = {
  models, descriptor, entryFrom, rosterFrom, DIMENSION, EFFORT_PATTERN, LIST_TIMEOUT_MS, MAX_PAGES,
};

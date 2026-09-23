// THE MODEL ROSTER, AS A CAPABILITY — ⚠ `source: 'live'`, and the ONE field on this runtime that
// no other adapter sets: `reStampOnResume`.
//
// The Claude adapter keeps a FROZEN table because its platform's authoritative roster needs a live
// query and the picker has to be usable before anything is running. This runtime answers
// `models.list()` off the same SDK the session already loads (`cursor-research.md`: `Cursor.models
// .list()`, CLI `--list-models`, API `GET /v1/models`), so the picker is populated from the wire
// and an id this build has never seen renders raw rather than being dropped.
//
// ⚠ A ROSTER CALL MUST NEVER THROW INTO A PICKER, AND MUST NEVER HANG ONE. Bounded by a timeout,
// cached, and answering an EMPTY roster with a reason on any failure. An empty live roster is a
// picker that shows the platform's own default and nothing else, which is what every session did
// before a picker existed; a thrown one is a settings page that will not open.
//
// ⚠ AND IT COSTS NO SECOND PROCESS HERE, WHICH IS THE ONE PLACE `in-process` IS CHEAPER RATHER
// THAN ONLY SAFER. The other live-roster adapter has to spawn a short-lived second `app-server`
// because the session's connection is busy with a turn; this one asks a library function.

const client = require('./client');

const LIST_TIMEOUT_MS = 8000;

let cached = null;

// ⚠ TOLERANT, LIKE EVERY OTHER READER IN THIS ADAPTER. The research names the VERB and the kind of
// ids it returns (`composer-2.5`, `claude-4-sonnet-thinking`, Grok/Gemini/GPT-5/Kimi/GLM, an
// `auto-smart` router on Teams/Enterprise) and does not print the result shape, so this takes the
// ids out of whichever plausible shape arrives and renders them raw. §5 item B1.
function idsFrom(result) {
  const rows = (result && (result.models || result.data || result.items))
    || (Array.isArray(result) ? result : []);
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (typeof row === 'string' && row) { out.push(row); continue; }
    const id = row && (row.id || row.model || row.name);
    if (typeof id === 'string' && id) out.push(id);
  }
  return out;
}

/** `Cursor.models.list()` under either export shape the beta SDK might use. */
function listFn(sdk) {
  const ns = sdk || {};
  const roots = [ns, ns.default, ns.Cursor, ns.default && ns.default.Cursor];
  for (const root of roots) {
    const models = root && root.models;
    if (models && typeof models.list === 'function') return () => models.list();
  }
  return null;
}

// ── ⚠ THE NORMALIZED CATALOG SHAPE (2026-09-21, U6) ──────────────────────────────────────────
//
// Every adapter's `models()` answers the same record now, and `main/runtime/model-catalog.js`
// turns it into the catalog a picker reads. ⚠ **AN EMPTY ROSTER MUST CARRY A REASON** — the
// catalog reads a reason-carrying empty list as `unavailable` (a measured failure) and a
// never-read one as `loading`, and collapsing those is a picker that says "no models" about a
// runtime nobody has asked yet.
// ⚠ THIS PLATFORM NAMES NOTHING. `models.list()` answers ids, so every entry's `label` is `null`
// and the picker renders the raw id — which is the honest answer, not a missing one.
const failure = (reason) =>
  ({ source: 'live', key: null, ids: [], models: [], defaultId: null, reason, truncated: false });

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(onTimeout()), ms);
    promise.then((v) => { clearTimeout(timer); finish(v); },
      (err) => { clearTimeout(timer); finish(failure((err && err.message) || 'models.list failed')); });
  });
}

async function fetchRoster() {
  const gate = await client.probe();
  if (!gate.ok) return failure(gate.reason || 'Dopl could not reach this runtime.');
  let list = null;
  try {
    list = listFn(await client.loadSdk());
  } catch (err) {
    return failure((err && err.message) || 'the SDK would not load');
  }
  if (!list) {
    return failure('this SDK build exposes no models.list()');
  }
  return withTimeout(
    Promise.resolve().then(list).then((result) => {
      const ids = idsFrom(result);
      if (!ids.length) return failure('this runtime answered models.list() with no models Dopl could read');
      return {
        source: 'live',
        // ⚠ THE SDK IS LOADED IN-PROCESS, so there is no binary path or CLI version to key on —
        // `null` says "this roster has no invalidation key", which is a different claim from a
        // key that never changes. `model-catalog.js › invalidate` is the reconnect hook instead.
        key: null,
        ids,
        // ⚠ NO `isDefault`: this platform declares none, and marking one would be Dopl inventing
        // a default it cannot back (INVARIANTS §11 — unknown is not empty).
        models: ids.map((id) => ({ id, label: null, short: null, isDefault: false, hidden: false, dimensions: {} })),
        defaultId: null,
        reason: '',
        truncated: false,
      };
    }),
    LIST_TIMEOUT_MS,
    () => failure('models.list() did not answer in time')
  );
}

/**
 * The offerable roster. ⚠ Unknown ids still render raw and round-trip — only the PICKS are closed.
 * ⚠ **ONLY A ROSTER WITH MODELS IN IT IS CACHED** (U6). The old `if (cached) return cached` pinned
 * the FIRST answer — including a failure — for the life of the app, so an operator who repaired
 * their install with Dopl open kept seeing an empty picker until they quit.
 */
async function models() {
  if (cached) return cached;
  const roster = await fetchRoster();
  if (roster.models.length) cached = roster;
  return roster;
}

/** Drop the cache. ⚠ For tests and for an explicit reconnect re-probe. */
function forget() { cached = null; }

// Descriptor half.
const descriptor = {
  source: 'live',
  // ⚠ null: reasoning-effort variants exist on this runtime but are documented as PLAN-GATED
  // variants of a model ID (`claude-4-sonnet-thinking`), not as a separate dimension the way the
  // other live-roster runtime exposes `model_reasoning_effort`. A dimension declared here renders
  // a control; declaring one whose values are really part of the id would render a control that
  // multiplies the roster by nothing. Absent, not `[]`, which would render an EMPTY control.
  dimensions: null,
  // ⚠ THE PICK RULE (2026-09-21, U5) — `open`, for the live-roster reason the Codex lane states in
  // full. Shared storage keeps the operator's pick as an opaque string after a SHAPE check and
  // interprets nothing; the value becomes an argument to the platform, so the alphabet is a gate.
  pick: {
    absent: '',
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$',
  },
  // ⚠ null, matching `dimensions: null` above — no model-scoped second dimension, so nothing
  // renders and nothing is storable.
  dimensionOptions: null,
};

module.exports = { models, forget, descriptor, LIST_TIMEOUT_MS };

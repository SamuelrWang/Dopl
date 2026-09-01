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

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(onTimeout()), ms);
    promise.then((v) => { clearTimeout(timer); finish(v); },
      (err) => { clearTimeout(timer); finish({ source: 'live', ids: [], aliases: [], reason: (err && err.message) || 'models.list failed' }); });
  });
}

async function fetchRoster() {
  const gate = await client.probe();
  if (!gate.ok) return { source: 'live', ids: [], aliases: [], reason: gate.reason };
  let list = null;
  try {
    list = listFn(await client.loadSdk());
  } catch (err) {
    return { source: 'live', ids: [], aliases: [], reason: (err && err.message) || 'the SDK would not load' };
  }
  if (!list) {
    return { source: 'live', ids: [], aliases: [], reason: 'this SDK build exposes no models.list()' };
  }
  return withTimeout(
    Promise.resolve().then(list).then((result) => {
      const ids = idsFrom(result);
      // ⚠ `aliases[0]` IS THE EMPTY STRING AND IT SETS NO MODEL AT ALL — the platform's own pick.
      // `descriptor.models.defaultMeansAbsent` is the convention the whole launch precedence chain
      // rests on: a link naming nothing this build knows STEPS ASIDE rather than spending the
      // platform default and discarding the rest.
      return { source: 'live', ids, aliases: [''].concat(ids), reason: '' };
    }),
    LIST_TIMEOUT_MS,
    () => ({ source: 'live', ids: [], aliases: [], reason: 'models.list() did not answer in time' })
  );
}

/** The offerable roster. ⚠ Unknown ids still render raw and round-trip — only the PICKS are closed. */
async function models() {
  if (cached) return cached;
  cached = await fetchRoster();
  return cached;
}

// Descriptor half.
const descriptor = {
  source: 'live',
  // ⚠ null: reasoning-effort variants exist on this runtime but are documented as PLAN-GATED
  // variants of a model ID (`claude-4-sonnet-thinking`), not as a separate dimension the way the
  // other live-roster runtime exposes `model_reasoning_effort`. A dimension declared here renders
  // a control; declaring one whose values are really part of the id would render a control that
  // multiplies the roster by nothing. Absent, not `[]`, which would render an EMPTY control.
  dimensions: null,
  defaultMeansAbsent: '',
  // ⚠ TRUE, AND IT IS THE ONLY `true` IN THIS FIELD ACROSS ALL THREE ADAPTERS. `cursor-research.md`
  // is explicit: `agent.model` is `undefined` after `Agent.resume(agentId)` unless respecified. So
  // a resumed session that did not re-stamp would silently run on the platform's default instead
  // of the model the operator chose — a posture change nobody made. `launch-spec.js › frames`
  // re-stamps from the session's own pick, and the `dopl/agentCreated` frame carries it so the
  // meter's denominator and the transcript agree about which model ran.
  reStampOnResume: true,
};

module.exports = { models, descriptor, idsFrom, listFn, LIST_TIMEOUT_MS };

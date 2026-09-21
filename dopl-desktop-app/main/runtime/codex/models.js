// THE MODEL ROSTER, AS A CAPABILITY — ⚠ `source: 'live'`, WHICH IS THE OPPOSITE OF THE CLAUDE
// LANE'S ANSWER AND IS WHY THAT FIELD EXISTS AT ALL.
//
// The Claude adapter keeps a FROZEN table because its platform's authoritative roster needs a live
// query and the picker has to be usable before anything is running. Codex answers `model/list`
// over the same app-server protocol the session already speaks, WITH each model's reasoning-effort
// options (`codex-research.md` §3) — so the picker is populated from the wire and an id this build
// has never seen renders raw rather than being dropped.
//
// ⚠ A ROSTER CALL MUST NEVER THROW INTO A PICKER, AND MUST NEVER HANG ONE. It spawns a short-lived
// `codex app-server` of its own — the session's connection is busy with a turn and is not a query
// surface — bounded by a timeout, cached, and answering an EMPTY roster with a reason on any
// failure. An empty live roster is a picker that shows the platform's own default and nothing
// else, which is what every session did before a picker existed; a thrown one is a settings page
// that will not open.
//
// ⚠ AND IT IS A SECOND CHILD PROCESS, WHICH IS THE COST OF `live`. Cached for the life of the app
// process: the roster changes when the operator upgrades their CLI, which they cannot do while it
// is running.

const client = require('./client');

const LIST_TIMEOUT_MS = 8000;

// ⚠ THE SECOND DIMENSION, AND ITS VALUES ARE THE PLATFORM'S OWN (`model_reasoning_effort`:
// none / minimal / low / medium / high / xhigh — `codex-research.md` §3). Declared here rather
// than in the descriptor so the descriptor keeps the same SHAPE as every other adapter's — it says
// THAT this runtime has a reasoning-effort dimension; this says what the dimension's values are,
// and `model/list` is what says which of them a given model offers.
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

let cached = null;

// ⚠ TOLERANT, LIKE EVERY OTHER READER IN THIS ADAPTER. The `model/list` result shape is not
// written down in the research, only what it CONTAINS ("models + reasoning-effort options"), so
// this takes the ids out of whichever of the plausible shapes arrives and renders them raw.
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

async function fetchRoster() {
  const gate = await client.probe();
  if (!gate.ok) return { source: 'live', ids: [], aliases: [], reason: gate.reason };
  return new Promise((resolve) => {
    let conn = null;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { if (conn) conn.close(); } catch (_) { /* best effort */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish({
      source: 'live', ids: [], aliases: [], reason: 'model/list did not answer in time',
    }), LIST_TIMEOUT_MS);
    try {
      // ⚠ `--ignore-user-config` HERE TOO. A roster read is the cheapest possible place for the
      // operator's own config to change what this app believes, and consistency across the two
      // spawn shapes is the whole reason the Claude lane insists on ONE assembly point.
      conn = client.connect({ args: ['--ignore-user-config'] });
      conn.request('initialize', client.initializeParams(appVersion()))
        .then(() => conn.request('model/list', {}))
        .then((result) => {
          clearTimeout(timer);
          const ids = idsFrom(result);
          // ⚠ `aliases[0]` IS THE EMPTY STRING AND IT SETS NO MODEL AT ALL — the platform's own
          // pick. `descriptor.models.defaultMeansAbsent` is the convention the whole launch
          // precedence chain rests on: a link naming nothing this build knows STEPS ASIDE rather
          // than spending the platform default and discarding the rest.
          finish({ source: 'live', ids, aliases: [''].concat(ids), reason: '' });
        })
        .catch((err) => {
          clearTimeout(timer);
          finish({ source: 'live', ids: [], aliases: [], reason: (err && err.message) || 'model/list failed' });
        });
    } catch (err) {
      clearTimeout(timer);
      finish({ source: 'live', ids: [], aliases: [], reason: (err && err.message) || 'could not start codex app-server' });
    }
  });
}

function appVersion() {
  try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
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
  // ⚠ REASONING EFFORT IS A SECOND DIMENSION THE OTHER RUNTIMES DO NOT HAVE, and declaring it is
  // what makes the control render at all (`§3.2`: absent -> no reasoning-effort control). `null`
  // elsewhere, a list here — never `[]`, which would render an empty control instead of none.
  dimensions: ['reasoningEffort'],
  defaultMeansAbsent: '',
  // ⚠ false: the thread carries its model through a resume by itself (`thread/resume` reopens the
  // conversation, it does not re-specify it), so nothing re-stamps it.
  reStampOnResume: false,
  // ── ⚠ THE PICK RULE (2026-09-21, U5) — `open`, WHICH IS THE OPPOSITE OF THE CLAUDE LANE'S ────
  //
  // That runtime's roster is FROZEN, so membership is the check. This one is `source: 'live'`:
  // the authoritative list is `model/list` off the connected binary, which shared storage cannot
  // call (it is async, it spawns a child, and a settings page must open without one). So storage
  // keeps the operator's pick as an OPAQUE STRING after a SHAPE check and interprets nothing —
  // `descriptor.models.pick.kind === 'open'` is the declaration that makes that legal.
  //
  // ⚠ A SHAPE CHECK IS NOT A ROSTER CHECK, AND SAYING SO IS THE POINT. This admits any id the
  // live roster could plausibly carry and rejects only what could not BE an id — anything with a
  // space, a quote, a shell metacharacter, a newline, or more than 64 characters. Narrowing it to
  // the live catalog (and refusing a stale id at PICK time while still rendering it raw on a
  // historical session card) is U6's job and needs the catalog U6 delivers.
  // ⚠ IT IS STILL A GATE, BECAUSE THE VALUE BECOMES `config.model` IN THE LAUNCH ARGV
  // (`launch-spec.js › overrideArgs`). `[A-Za-z0-9]` first, then the id alphabet, and nothing else.
  pick: {
    kind: 'open',
    stored: null, // no closed list to offer — the roster is the wire's
    accepted: null,
    canonical: null,
    absent: '', // `defaultMeansAbsent` — no `model` field at all, i.e. the platform's own pick
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$',
  },
  // ── ⚠ THE SECOND DIMENSION'S OPTIONS, DECLARED SO IT CAN BE WRITTEN (2026-09-21, U5) ─────────
  //
  // `dimensions: ['reasoningEffort']` above says THAT this runtime has the dimension; until now
  // nothing said what its values are, so `capability.js` could not validate a write and
  // `launch-spec.js`'s `config.model_reasoning_effort` read a `state.reasoningEffort` **that had
  // no producer anywhere in the tree** (F-390's shape: a control that writes nowhere). Declaring
  // the options is what turns it into a real storable setting.
  // ⚠ `contract.js › descriptorProblems` REFUSES a descriptor that names a dimension with no
  // options, so this pair cannot come apart.
  // ⚠ `fallback: 'absent'` — an unrecognised effort is DROPPED rather than floored, because there
  // is no narrowest member here: dropping it sets no field and the platform picks, which is what
  // every Codex session did before a picker existed. A CONTAINMENT dimension floors instead (see
  // `toolMode.secondaryAxis`, whose options are declared narrowest-first).
  dimensionOptions: {
    reasoningEffort: { options: REASONING_EFFORTS.slice(), default: null, fallback: 'absent' },
  },
};

module.exports = { models, descriptor, idsFrom, REASONING_EFFORTS };

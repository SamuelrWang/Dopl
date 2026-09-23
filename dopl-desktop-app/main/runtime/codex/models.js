// THE MODEL ROSTER, AS A CAPABILITY — ⚠ `source: 'live'`, WHICH IS THE OPPOSITE OF THE CLAUDE
// LANE'S ANSWER AND IS WHY THAT FIELD EXISTS AT ALL.
//
// (⚠ The Claude adapter is `live` too since 2026-09-22 — `runtime/claude/roster.js` reads
// `supportedModels()` off a turn-free CLI handshake — so "the opposite" is history.) Codex answers `model/list`
// over the same app-server protocol the session already speaks, WITH each model's reasoning-effort
// options — so the picker is populated from the wire and an id this build has never seen renders
// raw rather than being dropped.
//
// ⚠ A ROSTER CALL MUST NEVER THROW INTO A PICKER, AND MUST NEVER HANG ONE. It spawns a short-lived
// `codex app-server` of its own — the session's connection is busy with a turn and is not a query
// surface — bounded by a timeout, cached, and answering a FAILURE WITH A REASON.
//
// ── ⚠ THE FAILURE PATH IS HONEST NOW, AND THAT IS THE POINT OF THE 2026-09-21 (U6) REWRITE ────
//
// 🔒 **AN EMPTY ROSTER USED TO BE THE ANSWER TO EVERY FAILURE**, and a picker cannot tell that
// apart from a platform with no models. `main/runtime/model-catalog.js` is the contract that fixes
// it: this file reports `reason` on every failure and the catalog turns a reason-carrying empty
// roster into `status: 'unavailable'` — a different sentence and a different operator action from
// `loading`. **Empty is never "this runtime has no models".**
//
// 🔒 The app-server has no `--ignore-user-config` flag. The roster uses the same app-owned
// CODEX_HOME as a full launch, so model discovery cannot import user MCP servers, profiles or
// permission defaults merely by opening a picker. A failure still reads as `unavailable`, with
// the binary's reason, never an empty list that looks like "no models".
//
// ⚠ AND IT IS A SECOND CHILD PROCESS, WHICH IS THE COST OF `live`. Cached by RESOLVED BINARY AND
// VERSION (`resolve-bin.js` + `probe()`), not merely "for the process": an operator who upgrades
// or repoints `DOPL_CODEX_BIN` gets the new roster, and a FAILURE is re-tried rather than pinned
// for the life of the app (the cache layer's own TTL — `model-catalog.js › FAILURE_TTL_MS`).

const client = require('./client');
const configHome = require('./config-home');

const LIST_TIMEOUT_MS = 8000;

// ⚠ A CURSOR LOOP NEEDS A BOUND OR IT IS A HANG WITH EXTRA STEPS. A server that answers the same
// cursor forever, or one with a genuinely enormous roster, stops here and the catalog says
// `truncated` rather than pretending the list is complete.
const MAX_PAGES = 10;

// ⚠ THE SECOND DIMENSION, AND ITS VALUES ARE THE PLATFORM'S OWN (`model_reasoning_effort`:
// none / minimal / low / medium / high / xhigh — `codex-research.md` §3). Declared here rather
// than in the descriptor so the descriptor keeps the same SHAPE as every other adapter's — it says
// THAT this runtime has a reasoning-effort dimension; this says what the dimension's values are,
// and `model/list` is what says which of them a given model offers.
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

const DIMENSION = 'reasoningEffort';

let cached = null; // { key, roster }

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** `model/list` answers `{ data, nextCursor }` (measured, codex-cli 0.155.1). */
function rowsFrom(result) {
  return result && Array.isArray(result.data) ? result.data : [];
}

/**
 * ONE ROW → ONE NORMALIZED CATALOG ENTRY.
 *
 * ⚠ **THE FIELD NAMES ARE MEASURED, AND WHAT IS NOT MEASURED IS NOT INVENTED** (Implementation
 * Log D, against the ChatGPT-bundled alpha — tooling proof, not the contract): `id`,
 * `displayName`, `isDefault`, `hidden`, `defaultReasoningEffort`, and `supportedReasoningEfforts`
 * as `{ reasoningEffort, description }` OBJECTS. Snake-case twins are accepted as tolerance for a
 * CLI nobody here has run; nothing else is guessed at.
 *
 * ⚠ AN EFFORT THIS BUILD DOES NOT KNOW IS STILL OFFERED. `REASONING_EFFORTS` is what Dopl can
 * STORE (`descriptor.models.dimensionOptions`), and the model's own list is what it SUPPORTS —
 * when they disagree the intersection is what a picker may show, because an option Dopl cannot
 * persist is a control that writes nowhere. The dropped ones are counted, never silently lost.
 */
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
    // ⚠ THE INTERSECTION IS THE GATE — see `entryFrom`'s note. An effort outside the declared
    // dimension cannot be stored, so offering it would be F-390's shape again.
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

/** `<resolved path>@<version>` — the cache key. ⚠ BOTH HALVES: one operator, two installs. */
function cacheKey(gate) {
  return `${str(gate && gate.path) || '?'}@${str(gate && gate.version) || '?'}`;
}

function failure(key, reason) {
  return { source: 'live', key, ids: [], models: [], defaultId: null, reason, truncated: false };
}

/**
 * 🔒 **PAGINATED, AND THE REQUEST SPELLING IS NOW MEASURED (2026-09-22).** It was a symmetric guess
 * — Implementation Log D had measured the RESPONSE (`{ data, nextCursor }`) and never sent a second
 * page. `codex app-server generate-json-schema` on the supported `codex-cli 0.155.1` declares
 * `ModelListParams` as exactly three optional fields, and **`cursor` is the right one**:
 *
 *     cursor         "Opaque pagination cursor returned by a previous call."   string|null
 *     includeHidden  "include models that are hidden from the default picker"  boolean|null
 *     limit          "Optional page size; defaults to a reasonable server-side value."
 *
 * ⚠ **`includeHidden` IS DELIBERATELY NOT SENT.** Omitted, the server withholds hidden models,
 * which is exactly the roster a picker should offer — asking for them and filtering here would
 * make Dopl responsible for a policy the platform already has. `hidden` is still read off each row
 * (`rowFrom`), because a model can be hidden in the catalog and still be the one a SESSION is
 * already running, and a card must label what it cannot offer.
 * ⚠ **`limit` IS NOT SENT EITHER** — the server's own default is the page size Dopl wants, and a
 * number here would be Dopl guessing at a budget the platform tunes.
 *
 * The repeated-cursor guard below stays: it costs nothing and it is the one defence against a
 * server that answers page one forever.
 */
async function listPages(conn) {
  const rows = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = cursor ? { cursor } : {};
    const result = await conn.request('model/list', params);
    rows.push(...rowsFrom(result));
    const next = str(result && result.nextCursor);
    // ⚠ **`truncated` MEANS "DOPL STOPPED", NOT "THE SERVER RAN OUT", AND ONLY THE FIRST ARM IS
    // THE SERVER SAYING SO.** A repeated cursor and the page cap are both Dopl giving up on a
    // list it cannot prove it finished, and reporting either as a complete roster would be a
    // picker quietly claiming to know every model.
    if (!next) return { rows, truncated: false };
    if (next === cursor) return { rows, truncated: true };
    cursor = next;
  }
  return { rows, truncated: true };
}

/** ⚠ TAKES THE PROBE IT WAS GIVEN — `probe()` execs the binary, and asking twice per read is a
 *  second `--version` spawn for an answer the caller already holds. */
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
      conn = client.connect({ args: [], env: configHome.isolatedEnv(process.env) });
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

/**
 * ⚠ ORDER IS THE SERVER'S, UNTOUCHED. The plan's U6 scenario is "orders visible models FROM THE
 * RESPONSE"; re-sorting would make Dopl an authority on a ranking only the platform holds.
 * ⚠ HIDDEN MODELS ARE CARRIED, NOT DROPPED (Decision #2 keeps them "out of ordinary pickers"):
 * a session already running on one still has to be LABELLED, and `model-catalog.js` is where the
 * hidden flag stops it being offered.
 * ⚠ EXACTLY ONE DEFAULT IS THE PROTOCOL'S OWN RULE — `client.js › catalogGate` calls anything else
 * an unsupported protocol. Here the disagreement is REPORTED rather than silently tie-broken.
 */
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

/**
 * The offerable roster. ⚠ Unknown ids still render raw and round-trip — only the PICKS are closed.
 *
 * ⚠ **CACHED BY RESOLVED BINARY AND VERSION, NOT BY "THIS PROCESS"** (U6). The old cache pinned
 * the FIRST answer — including a failure — for the life of the app, so an operator who installed
 * or repaired Codex with Dopl open kept seeing an empty picker until they quit. The key is
 * `<path>@<version>`, so a repointed `DOPL_CODEX_BIN` or an upgraded CLI re-reads by construction;
 * a FAILED read is not cached here at all, and its retry cadence belongs to the one layer that can
 * see how often a picker is asking (`main/runtime/model-catalog.js › FAILURE_TTL_MS`).
 */
async function models() {
  const gate = await client.probe();
  const key = cacheKey(gate);
  if (cached && cached.key === key) return cached.roster;
  const roster = await fetchRoster(gate);
  // ⚠ ONLY A ROSTER WITH MODELS IN IT IS KEPT. A cached failure is a picker that cannot recover,
  // and `models.length` rather than `reason` is the predicate because a roster can arrive COMPLETE
  // and still carry a sentence (an unusual default marker, a truncated page run).
  if (roster.models.length) cached = { key: roster.key || key, roster };
  return roster;
}

/** Drop the cache. ⚠ For tests and for an explicit reconnect/version-change re-probe. */
function forget() { cached = null; }

// Descriptor half.
const descriptor = {
  source: 'live',
  // ⚠ REASONING EFFORT IS A SECOND DIMENSION THE OTHER RUNTIMES DO NOT HAVE, and declaring it is
  // what makes the control render at all (`§3.2`: absent -> no reasoning-effort control). `null`
  // elsewhere, a list here — never `[]`, which would render an empty control instead of none.
  dimensions: [DIMENSION],
  defaultMeansAbsent: '',
  // ⚠ **THE MODEL A LAUNCH THAT NAMED NONE STARTS ON (2026-09-23, Samuel: *"I think we should do
  // Sol"*)** — spent ONLY when this account's live `model/list` is `ready` and carries it, and
  // otherwise NO model is sent and Codex picks (`runtime/launch-default.js`; the catalog shows it as
  // the default for the same reason, `model-catalog.js › catalogFromRoster`). A preference, never a
  // refusal: an account without Sol launches exactly as it did before this line.
  launchDefault: 'gpt-6-sol',
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
  // space, a quote, a shell metacharacter, a newline, or more than 64 characters.
  // ⚠ **U6 NARROWS THE PICK AT THE PICKER, NOT HERE, AND THAT ASYMMETRY IS DELIBERATE.** The live
  // catalog decides what may be NEWLY SELECTED (`model-catalog.js`, and the renderer's
  // `lib/model-catalog.ts › canSelectModel`); STORAGE stays shape-only, because a durable record
  // written while Codex was reachable must not be silently erased by a read taken while it is not.
  // A stale id therefore keeps rendering as itself and stops being offered — which is exactly the
  // plan's "historical raw id still shown; a stale id cannot be newly selected".
  // ⚠ IT IS STILL A GATE, BECAUSE THE VALUE BECOMES `thread/start.model` in `launch-spec.js`.
  // `[A-Za-z0-9]` first, then the id alphabet, and nothing else.
  pick: {
    kind: 'open',
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
  // ⚠ **THESE ARE WHAT DOPL CAN STORE; THE CATALOG SAYS WHAT EACH MODEL SUPPORTS** (U6). The two
  // are different questions and the picker shows the INTERSECTION — `model/list` reports a
  // per-model `supportedReasoningEfforts`, and a model that offers none gets no control at all.
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

module.exports = {
  models, forget, descriptor, rowsFrom, entryFrom, rosterFrom, cacheKey,
  REASONING_EFFORTS, DIMENSION, LIST_TIMEOUT_MS, MAX_PAGES,
};

// THE SDK SHAPE LAYER — runtime-agnostic. Does the vendor build on THIS Mac still speak the protocol
// Dopl reads? Answered from the build's own LIVE description of itself, never from a version number.
//
// Three jobs, one vocabulary:
//   1. `checkShape(required, observed)` — the pure verdict. `required` is the adapter's
//      `descriptor.requiredShape`, TIERED by what a gap costs:
//        safety    a gap could let a session run with a Dopl restriction silently off → REFUSE
//        core      a gap breaks the session (no turn, no reply)                        → REFUSE
//        cosmetic  a gap degrades a label/meter                                         → drift note only
//      List ONLY what Dopl actually reads. An over-strict list bricks launches on harmless upstream
//      changes, which is its own outage.
//   2. `settleShape` / `launchShapeRefusal` — the live probe (`runtime.shape()`), cached per
//      build key (`roster-key.js`), retried with backoff on failure. A probe that FAILS is not a probe that
//      found a gap: it is `shape-unknown`, and a launch refuses with a sentence naming the cause
//      (fail CLOSED — an unchecked build could ignore Dopl's restrictions) while the next look
//      retries. The last-good shape persisted for the SAME build key stands in for a failed probe.
//   3. `recordDrift` / `driftReport` — the one "unrecognised SDK shape" ledger. Normalizers emit
//      `events.shapeDrift(where, detail)` when a frame does not read; core records it here.
//
// Shape (every key optional):
//   { methods: [name], notifications: { name: [fieldPath] }, requests: { name: [fieldPath] },
//     results: { method: [fieldPath] }, config: [key], exports: [name] }
// A fieldPath is dotted ('params.tokenUsage.total.inputTokens'). `observed` is a Shape of what IS
// there, or `{ paths: [flat strings] }` (see `flatten`).

const liveStore = require('./live-store');
const { rosterKeyOf } = require('./roster-key');

const TIERS = Object.freeze(['safety', 'core', 'cosmetic']);

// The gate's name for a server request no adapter recognises (`<prefix><method>`). Runtime-agnostic, so the
// gate can hold one rule for all of them (`session-profiles.js › grantDecision`): never a standing task
// grant, and DENIED outright on any restricted profile.
const UNRECOGNISED_REQUEST_PREFIX = 'unrecognised_request:';
const REFUSING = Object.freeze(['safety', 'core']);
const STATUS = Object.freeze({ NONE: 'none', KNOWN: 'known', UNKNOWN: 'shape-unknown' });

const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

// ── PURE ──────────────────────────────────────────────────────────────────────────────────────

/** One Shape → its flat path strings ('method X', 'notification X', 'notification X field.path', …). */
function flatten(shape) {
  const out = new Set();
  if (!shape || typeof shape !== 'object') return out;
  if (Array.isArray(shape.paths)) for (const p of list(shape.paths)) out.add(p);
  for (const m of list(shape.methods)) out.add(`method ${m}`);
  for (const c of list(shape.config)) out.add(`config ${c}`);
  for (const e of list(shape.exports)) out.add(`export ${e}`);
  // `values: { '<method> <field>': [allowed…] }` — a field's closed vocabulary as the BUILD declares it.
  if (shape.values && typeof shape.values === 'object' && !Array.isArray(shape.values)) {
    for (const scope of Object.keys(shape.values)) {
      for (const v of list(shape.values[scope])) out.add(`value ${str(scope)}=${v}`);
    }
  }
  for (const [kind, key] of [['notification', 'notifications'], ['request', 'requests'], ['result', 'results']]) {
    const group = shape[key];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    for (const name of Object.keys(group)) {
      const n = str(name);
      if (!n) continue;
      out.add(`${kind} ${n}`);
      for (const f of list(group[name])) out.add(`${kind} ${n} ${f}`);
    }
  }
  return out;
}

/** `{ ok, refuse, missing: { safety, core, cosmetic } }` — `ok` iff nothing is missing at any tier,
 *  `refuse` iff a safety or core item is missing. */
function checkShape(required, observed) {
  const have = flatten(observed);
  const missing = { safety: [], core: [], cosmetic: [] };
  for (const tier of TIERS) {
    for (const p of flatten(required && required[tier])) if (!have.has(p)) missing[tier].push(p);
  }
  const refuse = REFUSING.some((t) => missing[t].length > 0);
  return { ok: !refuse && missing.cosmetic.length === 0, refuse, missing };
}

/** Does this descriptor declare anything to check? */
function declares(descriptor) {
  const r = descriptor && descriptor.requiredShape;
  return !!r && TIERS.some((t) => flatten(r[t]).size > 0);
}

/** Registration problems for a declared `requiredShape` (sentences; empty = fine). */
function requiredShapeProblems(descriptor, runtime) {
  const r = descriptor && descriptor.requiredShape;
  if (r == null) return [];
  const id = descriptor.id;
  const problems = [];
  if (typeof r !== 'object' || Array.isArray(r)) return [`${id}: descriptor.requiredShape must be an object of tiers`];
  for (const k of Object.keys(r)) {
    if (TIERS.indexOf(k) === -1) problems.push(`${id}: descriptor.requiredShape.${k} is not a tier (${TIERS.join(', ')})`);
  }
  if (!declares(descriptor)) problems.push(`${id}: descriptor.requiredShape declares nothing — omit it instead`);
  const fn = runtime && runtime.shape;
  if (typeof fn !== 'function') problems.push(`${id}: descriptor.requiredShape is declared but runtime.shape is missing`);
  else if (fn.length !== 0) problems.push(`${id}: runtime.shape takes ${fn.length} arguments, contract says 0`);
  return problems;
}

function preview(items) {
  const shown = items.slice(0, 4).join('; ');
  return items.length > 4 ? `${shown}; +${items.length - 4} more` : shown;
}

/** The refusal sentence for a verdict that refuses (null when it does not). */
function refusalSentence(label, verdict) {
  if (!verdict || !verdict.refuse) return null;
  const gaps = verdict.missing.safety.concat(verdict.missing.core);
  return `${label || 'This runtime'} on this Mac no longer matches what Dopl needs to run it safely `
    + `(missing: ${preview(gaps)}), so Dopl will not start it. An update to Dopl is needed for this build.`;
}

// ── LIVE PROBE, CACHED PER BUILD KEY ──────────────────────────────────────────────────────────

const states = new Map(); // runtimeId → { key, status, observed, reason, persisted, at, attempts, inflight }

const keyOf = (adapter) => rosterKeyOf(adapter);

function backoffMs(attempts) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)}s`)), ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

function publicState(st) {
  return { status: st.status, key: st.key, observed: st.observed, reason: st.reason, persisted: !!st.persisted };
}

// A LAUNCH re-checks past this floor instead of waiting out the background backoff (final review H2): one
// transient failure (a slow cold start, a busy Mac) must not refuse every launch for minutes.
const LAUNCH_FLOOR_MS = 2000;
let clock = () => Date.now();

/** Ask the build to describe itself → `{ observed }` or `{ reason }`. Persists NOTHING (the caller does,
 *  only once it has confirmed the build key did not move while the probe ran — final review M1). */
async function probe(adapter) {
  try {
    const raw = await withTimeout(Promise.resolve().then(() => adapter.runtime.shape()), PROBE_TIMEOUT_MS);
    if (!raw || typeof raw !== 'object') throw new Error('the build described no protocol');
    return { observed: { paths: Array.from(flatten(raw)) } };
  } catch (err) {
    return { reason: (err && err.message) || 'the protocol check failed' };
  }
}

/** The settled state for a probe that ran on build `key` (persisting a live answer under that key). */
function settledFrom(id, key, prior, out) {
  if (out.observed) {
    if (key) liveStore.save('shape', id, key, out.observed);
    return { key, status: STATUS.KNOWN, observed: out.observed, reason: '', persisted: false, at: clock(), attempts: 0 };
  }
  const attempts = ((prior && prior.key === key && prior.attempts) || 0) + 1;
  // The same build answered before: its last-good description stands in (keyed, never cross-build).
  const persisted = key ? liveStore.read('shape', id, key) : null;
  if (persisted) {
    return { key, status: STATUS.KNOWN, observed: persisted, reason: out.reason, persisted: true, at: clock(), attempts };
  }
  return { key, status: STATUS.UNKNOWN, observed: null, reason: out.reason, persisted: false, at: clock(), attempts };
}

let generation = 0;

/** This runtime's protocol verdict once a probe has settled: `{ status, key, observed, reason, persisted,
 *  moved }`. `none` when the adapter declares no `requiredShape`. Never rejects.
 *  `opts.launch`: a launch is waiting — past `LAUNCH_FLOOR_MS` it re-probes instead of honouring backoff.
 *  `moved: true` = the build changed while it was checked; the answer is discarded, never filed. */
async function settleShape(adapter, opts) {
  if (!adapter || !adapter.descriptor || !declares(adapter.descriptor)) {
    return { status: STATUS.NONE, key: null, observed: null, reason: '', persisted: false };
  }
  const id = adapter.descriptor.id;
  const key = keyOf(adapter);
  const st = states.get(id);
  // An in-flight probe answers only for the build it is checking (final review M1).
  if (st && st.inflight && st.key === key) return st.inflight;
  if (st && !st.inflight && st.key === key) {
    // A live answer is kept for the build; a persisted stand-in and a failure are retried.
    if (st.status === STATUS.KNOWN && !st.persisted) return publicState(st);
    const floor = opts && opts.launch ? LAUNCH_FLOOR_MS : backoffMs(st.attempts);
    if (clock() - st.at < floor) return publicState(st);
  }
  const prior = st && st.key === key ? st : null;
  const gen = ++generation;
  const inflight = probe(adapter).then((out) => {
    const current = states.get(id);
    // Forgotten (`forgetShape`) or superseded by a newer probe while this one ran: its answer is not stored.
    if (!current || current.gen !== gen) return Object.assign(publicState(settledFrom(id, null, null, { reason: 'superseded' })), { moved: true });
    if (keyOf(adapter) !== key) {
      // The build switched mid-probe: what was observed may be either build's, so it is filed under NEITHER.
      states.delete(id);
      return { status: STATUS.UNKNOWN, key, observed: null, reason: 'the build changed while Dopl was checking it', persisted: false, moved: true };
    }
    const next = settledFrom(id, key, prior, out);
    states.set(id, next);
    return publicState(next);
  });
  states.set(id, Object.assign({}, prior || { key, status: STATUS.UNKNOWN, observed: null, reason: '', at: 0, attempts: 0 }, { key, inflight, gen }));
  return inflight;
}

/** Does this adapter declare anything in its SAFETY tier? Only then is an unchecked build refused. */
function declaresSafety(descriptor) {
  const r = descriptor && descriptor.requiredShape;
  return !!r && flatten(r.safety).size > 0;
}

/** Why a launch on this runtime is refused for its protocol, or null. `shape-unknown` refuses only an adapter
 *  that declares a SAFETY tier (final review H2b): without one, its safety is enforced per launch elsewhere
 *  (Claude's init contract), so an unreadable description is drift, not a reason to block work. A cosmetic-only
 *  gap is drift and never refuses. A build that switched mid-check is checked again once. */
async function launchShapeRefusal(adapter) {
  let st = await settleShape(adapter, { launch: true });
  if (st.moved) st = await settleShape(adapter, { launch: true });
  if (st.status === STATUS.NONE) return null;
  const label = adapter.descriptor.label;
  if (st.status === STATUS.UNKNOWN) {
    if (!declaresSafety(adapter.descriptor)) {
      recordDrift(adapter.descriptor.id, 'protocol', `could not check this build (${st.reason}); launching on the per-launch checks`);
      return null;
    }
    return `Dopl could not check that ${label} on this Mac speaks the protocol it needs (${st.reason}), `
      + 'so it will not start it: an unchecked build could ignore Dopl\'s safety settings. Try again; Dopl checks again on every launch.';
  }
  const verdict = checkShape(adapter.descriptor.requiredShape, st.observed);
  if (verdict.refuse) return refusalSentence(label, verdict);
  if (verdict.missing.cosmetic.length) {
    recordDrift(adapter.descriptor.id, 'protocol', `cosmetic gaps: ${preview(verdict.missing.cosmetic)}`);
  }
  return null;
}

/** Drop the probe state (tests; an explicit re-probe; a binary switch). */
function forgetShape(runtimeId) {
  // Deleting the state retires any in-flight probe: its `gen` no longer matches, so it cannot write back.
  if (runtimeId === undefined) states.clear();
  else states.delete(str(runtimeId));
}

/** Does the build last described for `runtimeId` declare `flatPath` (`notification item/started`)? `true` /
 *  `false` from a live or persisted description, `null` when none is known yet (no verdict either way). */
function knows(runtimeId, flatPath) {
  const st = states.get(str(runtimeId));
  if (!st || st.status !== STATUS.KNOWN || !st.observed || !Array.isArray(st.observed.paths)) return null;
  if (!st.pathSet) st.pathSet = new Set(st.observed.paths);
  return st.pathSet.has(str(flatPath));
}

/** The closed vocabulary the build last described for `runtimeId` declares for `scope` (`'turn/start effort'`):
 *  an array of allowed values; `[]` when the build was described but declares NO closed list for it; `null`
 *  when no description is known yet. The send-safety alphabet, sourced from the build, never typed. */
function valuesFor(runtimeId, scope) {
  const st = states.get(str(runtimeId));
  if (!st || st.status !== STATUS.KNOWN || !st.observed || !Array.isArray(st.observed.paths)) return null;
  const prefix = `value ${str(scope)}=`;
  return st.observed.paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
}

/** Tests only: a fake clock. */
function injectClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }

// ── DRIFT LEDGER ──────────────────────────────────────────────────────────────────────────────

const drift = new Map(); // "<runtime>|<where>" → { runtime, where, detail, count, firstAt, lastAt }
let diagFn = null;

function logDrift(...args) {
  try { (diagFn || require('../diag').diag)(...args); } catch (_) { /* a ledger never fails a read */ }
}

/** Record one unrecognised frame. Returns true the FIRST time `(runtime, where)` is seen this process. */
function recordDrift(runtimeId, where, detail) {
  const runtime = str(runtimeId) || 'unknown';
  const w = str(where) || 'unknown';
  const k = `${runtime}|${w}`;
  const now = Date.now();
  const held = drift.get(k);
  if (held) {
    held.count += 1;
    held.lastAt = now;
    held.detail = str(detail) || held.detail;
    return false;
  }
  drift.set(k, { runtime, where: w, detail: str(detail), count: 1, firstAt: now, lastAt: now });
  logDrift(`sdk-shape: ${runtime} sent a shape Dopl did not recognise at ${w}`, str(detail));
  return true;
}

/** Every recorded drift (optionally for one runtime), oldest first. */
function driftReport(runtimeId) {
  const want = runtimeId === undefined ? null : str(runtimeId);
  return Array.from(drift.values())
    .filter((e) => want === null || e.runtime === want)
    .map((e) => Object.assign({}, e));
}

function forgetDrift() { drift.clear(); }

/** Tests only. */
function injectDiag(fn) { diagFn = typeof fn === 'function' ? fn : null; }

/** A count read off a vendor frame: a finite number ≥ 0, else NULL — never 0 for "not there". */
function readCount(obj, ...pathParts) {
  let cur = obj;
  for (const p of pathParts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return typeof cur === 'number' && Number.isFinite(cur) && cur >= 0 ? cur : null;
}

module.exports = {
  TIERS,
  UNRECOGNISED_REQUEST_PREFIX,
  STATUS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  flatten,
  checkShape,
  declares,
  requiredShapeProblems,
  refusalSentence,
  settleShape,
  launchShapeRefusal,
  declaresSafety,
  knows,
  valuesFor,
  LAUNCH_FLOOR_MS,
  injectClock,
  forgetShape,
  recordDrift,
  driftReport,
  forgetDrift,
  injectDiag,
  readCount,
  _backoffMs: backoffMs,
};

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

async function probe(adapter, key, prior) {
  const id = adapter.descriptor.id;
  try {
    const raw = await withTimeout(Promise.resolve().then(() => adapter.runtime.shape()), PROBE_TIMEOUT_MS);
    if (!raw || typeof raw !== 'object') throw new Error('the build described no protocol');
    const observed = { paths: Array.from(flatten(raw)) };
    if (key) liveStore.save('shape', id, key, observed);
    return { key, status: STATUS.KNOWN, observed, reason: '', persisted: false, at: Date.now(), attempts: 0 };
  } catch (err) {
    const reason = (err && err.message) || 'the protocol check failed';
    const attempts = ((prior && prior.key === key && prior.attempts) || 0) + 1;
    // The same build answered before: its last-good description stands in (keyed, never cross-build).
    const persisted = key ? liveStore.read('shape', id, key) : null;
    if (persisted) {
      return { key, status: STATUS.KNOWN, observed: persisted, reason, persisted: true, at: Date.now(), attempts };
    }
    return { key, status: STATUS.UNKNOWN, observed: null, reason, persisted: false, at: Date.now(), attempts };
  }
}

/** This runtime's protocol verdict once a probe has settled: `{ status, key, observed, reason, persisted }`.
 *  `none` when the adapter declares no `requiredShape`. Never rejects. */
async function settleShape(adapter) {
  if (!adapter || !adapter.descriptor || !declares(adapter.descriptor)) {
    return { status: STATUS.NONE, key: null, observed: null, reason: '', persisted: false };
  }
  const id = adapter.descriptor.id;
  const key = keyOf(adapter);
  const st = states.get(id);
  if (st && st.inflight) return st.inflight;
  if (st && st.key === key) {
    // A live answer is kept for the build; a persisted stand-in and a failure are retried on backoff.
    if (st.status === STATUS.KNOWN && !st.persisted) return publicState(st);
    if (Date.now() - st.at < backoffMs(st.attempts)) return publicState(st);
  }
  const prior = st || null;
  const inflight = probe(adapter, key, prior).then((next) => {
    states.set(id, next);
    return publicState(next);
  });
  states.set(id, Object.assign({}, prior || { key, status: STATUS.UNKNOWN, observed: null, reason: '', at: 0, attempts: 0 }, { inflight }));
  return inflight;
}

/** Why a launch on this runtime is refused for its protocol, or null. Fails CLOSED on `shape-unknown`;
 *  a cosmetic-only gap is recorded as drift and never refuses. */
async function launchShapeRefusal(adapter) {
  const st = await settleShape(adapter);
  if (st.status === STATUS.NONE) return null;
  const label = adapter.descriptor.label;
  if (st.status === STATUS.UNKNOWN) {
    return `Dopl could not check that ${label} on this Mac speaks the protocol it needs (${st.reason}), `
      + 'so it will not start it: an unchecked build could ignore Dopl\'s safety settings. Try again in a minute; Dopl keeps checking.';
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
  if (runtimeId === undefined) states.clear();
  else states.delete(str(runtimeId));
}

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
  forgetShape,
  recordDrift,
  driftReport,
  forgetDrift,
  injectDiag,
  readCount,
  _backoffMs: backoffMs,
};

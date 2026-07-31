// Pure cores of the Realtime push transport, split out of `realtime.js` (§2
// 500-line cap). Everything here is deliberately FREE of ws / electron /
// network references — clocks and timers are injected — which is what lets
// `test/realtime.test.mjs` slice each fenced block and evaluate it verbatim
// under `node --test`, keeping the test honest to the code that ships.
//
// Keep the BEGIN/END sentinel comments and the purity rule: a require() of
// anything stateful in this file silently breaks that test's extraction.

// ─── BEGIN BREAKER (pure; unit-tested via source extraction) ─────────────────
// Circuit-breaker state machine guarding Realtime reconnect churn. States:
//   'closed'    — healthy; pushes are trusted, the loop uses the cheap path.
//   'open'      — too many consecutive failures; unhealthy, cooling down.
//   'half-open' — cooldown elapsed; ONE probe is allowed. Success → closed;
//                 failure → open again with a fresh cooldown.
// Pure: no electron / ws / network refs. `now` is injectable for tests.
function createBreaker(opts) {
  const threshold = (opts && opts.threshold) || 4;
  const cooldownMs = (opts && opts.cooldownMs) || 30000;
  const now = (opts && opts.now) || Date.now;
  let state = 'closed';
  let fails = 0;
  let openedAt = 0;

  function open(t) {
    state = 'open';
    openedAt = t;
    fails = threshold;
  }
  // A successful subscribe: from any state, close and clear the failure count.
  function onSuccess() {
    state = 'closed';
    fails = 0;
  }
  // A subscribe failure. In half-open a single failure re-opens immediately;
  // in closed we open once the consecutive count crosses the threshold.
  function onFailure() {
    if (state === 'half-open') { open(now()); return; }
    fails += 1;
    if (fails >= threshold) open(now());
  }
  // Open → half-open once the cooldown has elapsed (call before a probe).
  // Returns true when a probe should be attempted this tick.
  function maybeHalfOpen() {
    if (state === 'open' && now() - openedAt >= cooldownMs) {
      state = 'half-open';
      return true;
    }
    return state === 'half-open';
  }
  function isClosed() { return state === 'closed'; }
  function getState() { return state; }
  return { onSuccess, onFailure, maybeHalfOpen, isClosed, getState };
}
// ─── END BREAKER ─────────────────────────────────────────────────────────────

// ─── BEGIN WAKE-COALESCE (pure; unit-tested via source extraction) ───────────
// Batch a burst of INSERTs into at most ONE wake per channel per window: many
// rows landing together must trigger a single cheap catch-up, not one fetch per
// row. mark(id) adds to a Set and arms a single flush timer; flush() drains the
// unique ids to onFlush and disarms. Pure: `timers` injectable for tests.
function createWakeCoalescer(windowMs, onFlush, timers) {
  const T = timers || { setTimeout, clearTimeout };
  const pending = new Set();
  let timer = null;
  function flush() {
    timer = null;
    const ids = Array.from(pending);
    pending.clear();
    for (const id of ids) {
      try { onFlush(id); } catch (_) { /* one bad wake must not drop the rest */ }
    }
  }
  function mark(id) {
    if (id == null) return;
    pending.add(id);
    if (!timer) timer = T.setTimeout(flush, windowMs);
  }
  function size() { return pending.size; }
  return { mark, flush, size };
}
// ─── END WAKE-COALESCE ───────────────────────────────────────────────────────

// ─── BEGIN WAKE-PAYLOAD (pure; unit-tested via source extraction) ────────────
// THE single point where anything is read out of a realtime INSERT payload.
// It takes exactly ONE field — `channel_id`, the routing key that says WHICH
// loop to wake — and ignores everything else, so the transport keeps working
// byte-for-byte identically whether the row arrives whole or narrowed to the
// published column list (Q8). A payload that carries no usable channel id
// wakes nothing rather than guessing: the loops' own idle re-poll
// (REALTIME.LONG_IDLE_MS) is the backstop, so a dropped wake costs latency,
// never correctness. Both shapes are accepted because realtime-js normalizes
// the wire's `record` to `new` and a raw frame can reach here either way.
// Pure: object in, string|null out. No ws/electron/network refs.
function wakeChannelId(payload) {
  const rec = payload && (payload.new || payload.record);
  const id = rec && rec.channel_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// How many bytes that wake cost us. Measurement only — it is what proves the
// publication narrowing worked (and what would catch a regression that starts
// shipping whole rows again). Never throws on a cyclic/odd payload.
function wakePayloadBytes(payload) {
  try {
    return JSON.stringify(payload || null).length;
  } catch (_) {
    return 0;
  }
}
// ─── END WAKE-PAYLOAD ────────────────────────────────────────────────────────

// ─── BEGIN SUB-ERROR (pure; unit-tested via source extraction) ────────────────
// realtime-js calls `subscribe((status, err) => …)` with a SECOND argument on
// failure: the server's join-error payload. v2.1 dropped it, so every failure
// logged the bare word CHANNEL_ERROR and the field evidence could not tell
// "expired JWT" from "joined as anon and RLS refused" from "table not in the
// publication" — 1700 identical lines that named no cause. This normalizes
// whatever realtime-js hands over (Error, {reason}, {message}, string, nested
// cause) into ONE short reason string, and classifies whether it is a credential
// refusal, which is the only class a token rotation can fix.
// Pure: strings/objects in, string/boolean out. No ws/electron/network refs.

// Belt-and-braces: a server message must never smuggle a credential into the
// plaintext log, so strip anything JWT- or publishable-key-shaped first.
function redactSecrets(s) {
  return String(s)
    .replace(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '<jwt>')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '<apikey>');
}

function describeSubscribeError(err) {
  if (err == null) return 'no-payload';
  if (typeof err === 'string') return redactSecrets(err).slice(0, 200) || 'empty';
  const parts = [];
  if (err.message) parts.push(String(err.message));
  if (err.reason && String(err.reason) !== String(err.message)) parts.push(String(err.reason));
  if (err.cause) {
    const c = typeof err.cause === 'string' ? err.cause : err.cause.reason || err.cause.message || '';
    if (c && !parts.includes(String(c))) parts.push(`cause=${c}`);
  }
  if (parts.length === 0) {
    try { return redactSecrets(JSON.stringify(err)).slice(0, 200); } catch (_) { return 'unserializable'; }
  }
  return redactSecrets(parts.join(' | ')).slice(0, 200);
}

// Does this reason mean "your credential was refused"? Those are fixable by
// rotating the token; a bad filter or an unpublished table is not.
function isAuthFailure(reason) {
  return /jwt|token|expired|unauthor|forbidden|not authorized|permission denied|40[13]/i.test(
    String(reason || '')
  );
}
// ─── END SUB-ERROR ───────────────────────────────────────────────────────────

// ─── BEGIN WS-HEALTH (pure; unit-tested via source extraction) ───────────────
// THE per-workspace health predicate. A channel loop must trust push for ITS
// workspace ONLY when the transport is started, the breaker is closed, and THAT
// ws's own sub is actually SUBSCRIBED — never merely because SOME OTHER ws is up.
// Global isHealthy() (>=1 sub) would otherwise leave a loop whose own ws errored
// stuck waiting on wakes that can never arrive (the ~3-min-to-consent bug): green
// globally, silent for the ws that matters. Pure over its inputs so the test can
// lock the "one ws errored while another is subscribed" case with no ws/electron.
function wsHealthy(started_, breakerClosed, sub) {
  return !!(started_ && breakerClosed && sub && sub.subscribed);
}
// ─── END WS-HEALTH ───────────────────────────────────────────────────────────

// ─── BEGIN JOIN-GATE (pure; unit-tested via source extraction) ───────────────
// Which workspaces may be JOINED right now. Absolute rule: with no user JWT we
// join NOTHING, because realtime-js would join as `anon` and an anon subscriber
// crashes the project's CDC pipeline for every client. Pure, so "fail closed" is
// a truth table instead of a comment — and so the ordering contract (a join only
// ever happens after applyAuth has produced a credential) is testable.
function joinableSet(hasCred, desired) {
  return hasCred ? new Set(desired || []) : new Set();
}
// ─── END JOIN-GATE ───────────────────────────────────────────────────────────

module.exports = {
  createBreaker,
  createWakeCoalescer,
  wakeChannelId,
  wakePayloadBytes,
  redactSecrets,
  describeSubscribeError,
  isAuthFailure,
  wsHealthy,
  joinableSet,
};

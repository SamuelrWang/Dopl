// Headless spawn POOL — N concurrent sessions, one per session key (D1, 2026-07-31).
//
// WHAT THIS REPLACES. session-spawner.js kept `const active = new Set()` of CHANNEL ids:
// ONE headless spawn per channel, anywhere in it, and every other accepted trigger in that
// channel deferred behind it (measured live: 2m13s before a second thread was picked up).
// The multiplayer plan needs N team agents working in ONE channel at the same time, so the
// per-channel binary is gone. Concurrency is now keyed by the SESSION KEY and only the
// TOTAL is capped.
//
// THE KEY IS store.slotKey — the one definition (session-store.js), imported, never
// re-spelled as a string concat here or anywhere else. It is (channel, thread) for every
// pair-shaped caller and (channel, AGENT) for a summoned team agent; the pool never parses
// the key, it only compares it.
//
// FIX S5: this file used to call `store.sessionKey(channelId, taskId)` while its own header
// claimed the pool takes whatever key it is handed. It did not — it re-derived one, dropping
// `agentId` on the floor. A team session has NO thread (`taskId` ''), so every agent of one
// channel collapsed onto the single `channelId + ':'` slot: the first agent's spawn made
// every other agent in that channel read as 'same-key' busy. `slotKey` is byte-for-byte
// `sessionKey(channelId, taskId)` whenever no agentId is passed, so every pair caller lands
// exactly where it always did.
//
// TWO REFUSALS, ONE ANSWER. `claim` fails for two different reasons and the caller answers
// both the same way — today's busy defer (queued milestone in the thread + the RESEND
// bubble), because from the requester's side they are the same event: accepted, not yet
// started.
//   'same-key'  a spawn is ALREADY running for this exact session. This is the old
//               one-per-slot bug guard and it stays absolute: two spawns for one key would
//               share the resume id and interleave turns in one conversation.
//   'at-cap'    the machine is already running MAX_CONCURRENT_SESSIONS spawns. Different
//               key, no room.
// The claim is synchronous and authoritative, which also closes a race the old Set had:
// the busy check used to run BEFORE `await resolveClaude()` and the add AFTER, so two
// same-key triggers arriving together could both pass the check and both spawn.
//
// LOOP SAFETY IS PER SESSION AND UNCHANGED. Nothing here touches a budget: each headless
// spawn still carries MAX_RUNTIME_MS / MAX_OUTPUT_BYTES (session-spawner), each window
// session still carries the turn cap (24), the idle TTL and the cost cap (settings.js), and
// the window budget MAX_SESSION_WINDOWS (6) is a separate, engine-side ceiling. See the
// note on MAX_CONCURRENT_SESSIONS below for what N concurrency does to that arithmetic.

const store = require('./session-store');

// ─── BEGIN SESSION-POOL-PURE (pool bookkeeping; unit-tested via source extraction) ──
// Free var: `store` (required above) — so the test drives the REAL pool with a fake
// store and no host binding of its own.

// The global ceiling on concurrently RUNNING headless spawns, all channels and all
// threads together.
//
// COST EXPOSURE IS NOW MULTIPLICATIVE. Every per-session bound (turns, idle TTL, cost cap,
// runtime, output bytes) is exactly that — PER SESSION — so this constant is the multiplier
// on all of them at once: the worst case this machine can reach is N x the per-session
// ceiling, not the per-session ceiling. 4 is chosen to keep that product in the same order
// of magnitude as today's 1 while still letting a small team of agents work in parallel.
// A per-OWNER budget (spend and concurrency accounted against the operator, across
// channels and both execution paths) is the real answer and is deliberately v1.1 —
// see docs/MULTIPLAYER-PLAN.md, "Deliberately NOT in this build" (cost meter).
const MAX_CONCURRENT_SESSIONS = 4;

// sessionKey -> { key, channelId, taskId, startedAt }. Live handles never land here; this
// is bookkeeping only, so a leaked entry costs a slot and nothing else.
const active = new Map();

function keyFor(a) {
  return store.slotKey(a);
}

// Take a slot. Returns { ok:true, key } or { ok:false, reason:'same-key'|'at-cap', key }.
// SYNCHRONOUS on purpose: the check and the take must not straddle an await.
function claim(a) {
  const key = keyFor(a);
  if (active.has(key)) return { ok: false, reason: 'same-key', key };
  if (active.size >= MAX_CONCURRENT_SESSIONS) return { ok: false, reason: 'at-cap', key };
  active.set(key, {
    key,
    channelId: String((a && a.channelId) || ''),
    taskId: String((a && a.taskId) || ''),
    startedAt: Date.now(),
  });
  return { ok: true, key };
}

// Free a slot. Idempotent (a retry path may release once for several attempts); returns
// whether a slot was actually held.
function release(key) {
  return active.delete(String(key || ''));
}

// Is THIS session's slot taken? Never "is this channel working" — that question is what
// this module exists to stop asking.
function isBusy(a) {
  return active.has(keyFor(a));
}

function atCap() {
  return active.size >= MAX_CONCURRENT_SESSIONS;
}

function size() {
  return active.size;
}

// Accounting (pure read): one row per live spawn, carrying the key plus the identity
// pieces a chips UI needs. `status` is 'running' for every row — a slot exists only while
// its spawn does — and is present so this shape matches the engine's own live-session
// listing (session-reopen.listLiveSessions).
function listActive() {
  const out = [];
  for (const e of active.values()) {
    out.push({ key: e.key, channelId: e.channelId, taskId: e.taskId, status: 'running', startedAt: e.startedAt });
  }
  return out;
}

// ─── END SESSION-POOL-PURE ──────────────────────────────────────────────────────────

module.exports = { MAX_CONCURRENT_SESSIONS, claim, release, isBusy, atCap, size, listActive };

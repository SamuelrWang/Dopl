// THE AGENT ID — the identity ONE spawned agent instance wears.
//
// ⚠ IT REPLACED THE STONE-NAME POOL (2026-08-21, Samuel's ruling). Until this file existed a
// session pill was named from a curated 60-handle pool (`main/agent-names.js`, a byte-port of
// `src/features/channels/server/agent-names.ts`, pinned by a parity test). Both copies and the
// parity test are DELETED. The pool was a per-channel, first-free-handle picker whose whole
// contract — "the same room state always yields the same next name" — was written for ONE
// session per (channel, thread). Multiplayer breaks that premise: N agents run on one thread at
// once, they come and go, and a handle returned to the pool is immediately re-issued to a
// DIFFERENT agent, so `@flint` in the transcript stops naming anything stable. A RANDOM id per
// INSTANCE is the shape that survives: it is minted once at spawn, never recycled, and it is
// what an operator @-mentions to address one agent among several (`main/session-dispatch.js`).
//
// THE CHARSET IS NOT A PREFERENCE. It is `^[a-z][a-z0-9]{7}$`, which is deliberately a SUBSET of
// the addressing charset the rest of the system already enforces:
//   • `channel_sessions.name`'s SQL CHECK  `^[a-z][a-z0-9-]{1,30}$`
//   • `src/features/channels/schema-sessions.ts › SESSION_NAME_RE`, character for character
// So an id minted here can never 400 the state push or violate the column constraint, and no
// migration was needed to ship this. It also carries no `-`, which keeps it unambiguous inside
// the `<channel>:<thread>:<agent>` session key (`main/session-store.js › sessionKey`).
//
// ⚠ CSPRNG, AND MODULO-BIAS-FREE. `crypto.randomInt(max)` is rejection-sampled by Node itself,
// so this does not do `% alphabet.length` over random bytes. The id is not a secret — it is
// printed in prompts and rendered in the UI — but it IS an addressing token: two live agents
// colliding on one id would make `@id` ambiguous, and 26 * 36^7 (~2.0e12) makes that
// unreachable for the six sessions a machine may hold (MAX_CONCURRENT_SESSIONS).
//
// PURE + electron-free, like `agent-names.js` was, so the truth tables `require` it directly.

const crypto = require('crypto');

/** Total characters in an id. */
const AGENT_ID_LEN = 8;

/** ⚠ The FIRST character may not be a digit — the shared charset above demands a letter. */
const FIRST_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const REST_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * The shape an agent id has. ⚠ Anchored and EXACT-length: this is used as an acceptance test on
 * values that arrive from a renderer (`main/session-ipc-ops.js`) and as the @-mention parser's
 * candidate filter, so "starts with something id-shaped" is not good enough.
 */
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

/** One fresh agent id. Pure of everything but the CSPRNG. */
function newAgentId() {
  let out = FIRST_CHARS[crypto.randomInt(FIRST_CHARS.length)];
  for (let i = 1; i < AGENT_ID_LEN; i += 1) {
    out += REST_CHARS[crypto.randomInt(REST_CHARS.length)];
  }
  return out;
}

/** TRUE only for a string of exactly this shape. Coerces nothing — a non-string is not an id. */
function isAgentId(value) {
  return typeof value === 'string' && AGENT_ID_RE.test(value);
}

module.exports = { AGENT_ID_LEN, AGENT_ID_RE, newAgentId, isAgentId };

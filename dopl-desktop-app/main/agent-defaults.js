// DEFAULT AGENT SETTINGS — the pair, the model, the runtime and the chaining flag a NEWLY
// CREATED channel starts with. LOCAL ONLY, never sent to Dopl (2026-09-18, Samuel's ruling:
// "profile popup gets an Agents tab; new channels inherit it instead of the hardcoded blanks").
//
// ⚠ **ITS OWN MODULE, NOT A FOURTH RECORD IN `channel-prefs.js`.** That file is at the §1
// 500-line cap and, more importantly, everything in it is keyed BY CHANNEL: this record is keyed
// by nothing at all. It is one answer per machine-user, which is a different reason to change.
//
// ── ⚠ WHAT THIS IS NOT: A SECOND CONSUMER OF THE LAUNCH POSTURE ────────────────────────────
//
// Read `channel-prefs.js`'s H2 block before touching this file. The whole safety argument there
// is a CONSUMER COUNT: the durable per-channel posture is read at exactly ONE call site
// (`session-ipc-ops.js › sessions:launch`), and `test/session-preset-start.test.mjs` pins that
// `getLaunchPosture` appears in `channel-dir-ipc.js` and nowhere else.
//
// ⚠ NOTHING HERE IS EVER READ AT A SPAWN. This record is a SEED: it is copied INTO a channel's
// own posture record, once, at the moment that channel is created, by a renderer executing a
// creation a human just performed. Every later read is the per-channel record, through the one
// consumer that already existed. **Do not wire `getAgentDefaults` into `session-engine.js`, into
// any launch path, or into `getLaunchPosture`'s fallback** — a defaults record consulted at spawn
// time is an ambient posture read at a spawn no human is attending, which is exactly what H2
// forbids, and it would additionally re-point every EXISTING channel at a value its operator set
// for new ones.
//
// ⚠ AND THAT IS ALSO WHY THE SEED IS WRITE-ONCE PER CHANNEL. `seedChannel` refuses when the
// channel already has a stored posture, so a re-created row, a retry, or a second renderer racing
// the same creation cannot rewrite a channel the operator has since configured. "Existing
// channels untouched" is a property of this function, not of who calls it.
//
// SECURITY — every write is re-validated here against the frozen enums below, the same hard/soft
// split `channel-prefs.js › normalizePreset` uses: an unknown value on either AXIS rejects the
// whole write, an unknown MODEL or RUNTIME is simply absent. Nothing but the validated members is
// ever stored; there is no free-text field and no path.
//
// PRIVACY — local electron-store only. Never POSTed to Dopl, never in a channel message, never
// off this machine. The diag line carries the two enum values and nothing else.

const Store = require('electron-store');
const { normalizeModelId } = require('./session-model');
const channelPrefs = require('./channel-prefs');
const channelRuntime = require('./channel-runtime');
const { diag } = require('./diag');

const store = new Store();

// ─── BEGIN AGENT-DEFAULTS-VALIDATE (pure; unit-tested via source extraction) ──
// No electron/fs/store/require refs below, so test/agent-defaults.test.mjs can slice this block
// and evaluate it verbatim (same pattern as CHANNEL-PREFS-VALIDATE).

// The FROZEN enums, mirroring `session-profiles.js` TOOL_MODES / MESSAGE_MODES exactly as
// `channel-prefs.js` does. A value outside them is a REJECTED write, not a coerced one.
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

// ⚠ THE SAME MOST-RESTRICTIVE PAIR `channel-prefs.js › DEFAULT_PRESET` SPELLS, and it must stay
// the same pair: this is what the Agents tab shows an operator who has never opened it, and a
// machine with no defaults record must seed nothing different from what it seeds today.
const FACTORY_DEFAULTS = { tools: 'manual', messages: 'ask', agentChain: false };

/**
 * Validate an arbitrary value into a defaults record, or null when it is not one.
 *
 * ⚠ BOTH AXES HARD, MODEL AND RUNTIME SOFT, CHAIN FAIL-CLOSED — the three disciplines this tree
 * already uses, unchanged:
 *  · a half-valid PAIR is rejected whole (`channel-prefs.js`: a partially applied posture is the
 *    "one switch, two meanings" confusion the two axes exist to remove);
 *  · an unknown MODEL or RUNTIME is ABSENT rather than fatal, so a desktop that has not heard of
 *    a newer id can still store a pair;
 *  · `agentChain` is `=== true` and nothing else, because it lifts a bound.
 * Extra properties are dropped; nothing else is ever stored.
 */
function normalizeDefaults(raw, normalizeModel, normalizeRuntime) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tools = typeof raw.tools === 'string' ? raw.tools : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (TOOL_MODES.indexOf(tools) === -1) return null;
  if (MESSAGE_MODES.indexOf(messages) === -1) return null;
  const next = { tools: tools, messages: messages, agentChain: raw.agentChain === true };
  // ⚠ OMITTED WHEN ABSENT, never written as '' or null — `channel-prefs.js › normalizePreset`'s
  // rule, for its reason: a record from before a field and a record whose field was cleared must
  // be the SAME record, so no reader can grow a third state to get wrong.
  const model = normalizeModel(raw.model);
  if (model) next.model = model;
  // ⚠ `''` IS THE DEFAULT ADAPTER AND IS NOT A PICK (`channel-runtime.js › normalizeRuntimeId`),
  // so it is stored as an absence exactly like an unregistered id.
  const runtime = normalizeRuntime(raw.runtime);
  if (runtime) next.runtime = runtime;
  return next;
}

/**
 * The record as the RENDERER sees it — the stored one or the factory pair, and ALWAYS carrying
 * `model` and `runtime` keys.
 *
 * ⚠ THE KEYS ARE PRESENT ON THE WAY OUT EVEN WHEN STORAGE OMITS THEM, and that asymmetry is the
 * point rather than an inconsistency to tidy away. It is the SAME rule
 * `channel-prefs.js › effectivePosture` states: the web's capability probes
 * (`lib/permission-modes.ts › hasModelKey`, `lib/runtime-capability.ts › hasRuntimeKey`) are
 * OWN-KEY tests, and a missing key reads as "this desktop has no such concept" — which would
 * render NO row, and the only way to store a value is the row that was never drawn.
 */
function effectiveDefaults(stored) {
  const base = stored || FACTORY_DEFAULTS;
  return {
    tools: base.tools,
    messages: base.messages,
    agentChain: base.agentChain === true,
    model: (stored && stored.model) || null,
    runtime: (stored && stored.runtime) || '',
  };
}

// ─── END AGENT-DEFAULTS-VALIDATE ─────

const DEFAULTS_KEY = 'agentDefaults'; // { tools, messages, agentChain, model?, runtime? }

function normalizeStored(raw) {
  return normalizeDefaults(raw, normalizeModelId, channelRuntime.normalizeRuntimeId);
}

function readStored() {
  try {
    return normalizeStored(store.get(DEFAULTS_KEY));
  } catch (_err) {
    return null; // an unreadable store seeds the factory pair, which is the restrictive one
  }
}

/**
 * THE EFFECTIVE DEFAULTS. ⚠ NEVER null — a machine that has never opened the Agents tab really
 * does start new channels at manual/ask, and saying so is the truth. Reading never writes.
 */
function getAgentDefaults() {
  return effectiveDefaults(readStored());
}

/**
 * Persist the defaults. `{ ok: false }` and NO mutation when either axis is unknown — fail-closed,
 * so a rejected write can never leave a half-applied record behind.
 *
 * ⚠ THE WHOLE RECORD IS REWRITTEN, so a caller that omits `model` or `runtime` CLEARS it. That is
 * the opposite of `channel-prefs.js › postureInto`'s carry-through rule and it is deliberate:
 * there is exactly ONE surface writing this record (the profile popup's Agents tab), it always
 * sends the whole record, and there is no second control that could drop a field it does not know
 * about. If a second writer ever appears, port the `hasOwnProperty` idiom before it ships.
 */
function setAgentDefaults(raw) {
  const next = normalizeStored(raw);
  if (!next) return { ok: false };
  try {
    store.set(DEFAULTS_KEY, next);
  } catch (err) {
    diag('agent-defaults: could not persist —', err && err.message);
    return { ok: false };
  }
  diag('agent-defaults', next.tools, next.messages, next.agentChain ? 'chain' : 'no-chain');
  return { ok: true, defaults: effectiveDefaults(next) };
}

/**
 * SEED A NEWLY CREATED CHANNEL FROM THE DEFAULTS — the one and only inheritance point.
 *
 * `{ ok, seeded }`. `seeded: false` is the ordinary answer, not a failure: it means the channel
 * already had a posture of its own, so nothing was written.
 *
 * ⚠ **THE GUARD IS `hasLaunchPosture`, AND IT IS WHAT MAKES "EXISTING CHANNELS UNTOUCHED" TRUE.**
 * A channel the operator has ever configured is skipped whole, including its chaining flag — a
 * partial seed over a configured room would be this function inventing a third state neither
 * record can express.
 *
 * ⚠ IT WRITES THE PER-CHANNEL RECORDS, and from that moment those records are the only thing any
 * launch reads. Changing the defaults later moves nothing that already exists, by construction.
 */
function seedChannel(channelId) {
  if (!channelId) return { ok: false, seeded: false };
  if (channelPrefs.hasLaunchPosture(channelId)) return { ok: true, seeded: false };
  const defaults = getAgentDefaults();
  // ⚠ `model` IS PASSED ONLY WHEN ONE IS STORED. `channel-prefs.js › postureInto` treats the
  // KEY'S PRESENCE as the signal and `''` as a real "clear it" value, so forwarding a null model
  // would be this seed making a pick nobody made.
  const preset = { tools: defaults.tools, messages: defaults.messages };
  if (defaults.model) preset.model = defaults.model;
  const res = channelPrefs.setLaunchPosture(channelId, preset);
  if (!res || res.ok !== true) return { ok: false, seeded: false };
  // ⚠ AFTER THE PAIR AND ONLY ON A SUCCESSFUL ONE, the order `channels:setLaunchPosture` already
  // uses: a rejected posture must never half-apply a runtime or a bound.
  if (defaults.runtime) channelRuntime.setChannelRuntime(channelId, defaults.runtime);
  if (defaults.agentChain) channelPrefs.setAgentChain(channelId, true);
  diag('agent-defaults: seeded', String(channelId).slice(0, 8), defaults.tools, defaults.messages);
  return { ok: true, seeded: true };
}

module.exports = {
  DEFAULTS_KEY,
  FACTORY_DEFAULTS,
  normalizeDefaults,
  effectiveDefaults,
  getAgentDefaults,
  setAgentDefaults,
  seedChannel,
};

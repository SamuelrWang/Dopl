// Per-channel LAUNCH PREFERENCES — LOCAL ONLY, never sent to Dopl.
//
// TWO DURABLE RECORDS, both keyed by channel id, both read only by a path where a HUMAN is
// pressing the button they apply to:
//   THE LAUNCH POSTURE  the two permission axes the operator's OWN agent starts on when they
//                       press Launch on the Agents tab (`channelLaunchPosture`).
//   AUTO-SEND           whether that agent's drafted reply posts without a Send click
//                       (`channelAutoSend`, default OFF).
//
// THE TWO AXES (session-profiles.js is the authority on what each mode allows):
//   AXIS A  tools    = manual | accept_edits | auto | bypass
//   AXIS B  messages = ask | auto_inbound | auto_outbound | auto_both
// The default for a channel with nothing stored is the MOST RESTRICTIVE pair,
// { tools: 'manual', messages: 'ask' } — an absent or corrupt record can never read as more
// permissive than it is.
//
// ── ⚠ THE SINGLE-USE PERMISSION ARM LIVED HERE AND IS DELETED (2026-08-20, Samuel's ruling) ──
//
// `channelPermissionPresets` held a THIRD record: a pair the operator picked on an inbound
// consent card before clicking Allow, made SINGLE USE (`consumePermissionPreset` returned and
// deleted in one call), EXPIRING (30 minutes) and consumable by exactly ONE caller (the
// consent-approved responder launch). All three mechanisms existed to enforce H2 — that a
// stored pair may only ever apply to a launch a human is ACTIVELY approving in that moment —
// after a durable version of the same idea silently re-armed every later session on a channel.
//
// ⚠ IT WAS DELETED BECAUSE ITS SURFACE HAD ALREADY GONE, AND NOBODY HAD NOTICED. The arm's web
// controls lived inside `launch-panel.tsx`'s INBOUND branch, and that branch stopped rendering
// at the 2026-08-18 consent-surface rewrite: the panel's one consumer is the outbound send box,
// so `kind === "inbound"` was never true in production (measured, F-233). An arm nothing can arm
// is not a safety mechanism, it is a store key — and keeping it would have left the H2 argument
// attached to a record no human could ever set.
//
// ⚠ WHAT DID **NOT** CHANGE, AND MUST NOT: H2 ITSELF. A stored posture still only ever reaches a
// spawn by being HANDED IN per launch (`spec.startModes`), by a caller executing a decision a
// human is making right now. The posture below is read at exactly ONE call site —
// `channel-dir-ipc.js › sessions:launch`, the operator's own Launch button on their own thread —
// and every other spawn shape (a peer wake, a resume, a recreate) passes nothing and inherits
// the reducer's manual/ask. **Wiring this record to a second consumer re-opens the failure H2
// exists to prevent.** `test/session-preset-start.test.mjs` pins the consumer count, and that
// count — not the TTL the arm used to carry — is what actually kept H2 closed.
//
// SECURITY — every write is re-validated HERE against the frozen enums above and rejected
// outright when either value is unknown; nothing but the two enum members is ever written. There
// is no free-text field, no path, and no id other than the channel's (UUID-gated AND sender-bound
// by channel-dir-ipc.js before it reaches this module).
//
// PRIVACY — these live ONLY in the local electron-store. Never POSTed to Dopl, never put in a
// channel message, never off this machine. The diag line carries the channel id PREFIX plus the
// two enum values, so a support log can explain a posture; there is no free text in it to leak.
//
// This module OWNS the storage + validation. The IPC surface lives in channel-dir-ipc.js.

const Store = require('electron-store');
// ⚠ THE MODEL'S FROZEN LIST LIVES IN `session-model.js`, NOT HERE, and this file only validates
// against it — the same discipline the two axes follow against `session-profiles.js`. That module
// is PURE (no electron), so requiring it costs this one nothing.
const { normalizeModelId } = require('./session-model');
const { diag } = require('./diag');

const store = new Store();

// ─── BEGIN CHANNEL-PREFS-VALIDATE (pure; unit-tested via source extraction) ──
// No electron/fs/store/require refs below, so test/channel-prefs.test.mjs can
// slice this block and evaluate it verbatim (same pattern as CHANNEL-DIR-RESOLVE).

// The FROZEN enums. They mirror session-profiles.js TOOL_MODES / MESSAGE_MODES;
// a value outside them is not "unknown, treat as default" on the WRITE path — it
// is a rejected write, so a hostile or version-skewed page cannot park a garbage
// posture that some later reader coerces in an unexpected direction.
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

// The most restrictive pair — what an unset channel resolves to.
const DEFAULT_PRESET = { tools: 'manual', messages: 'ask' };

// Validate an arbitrary value into a preset, or null when it is not one. BOTH
// axes must be present and known: a half-valid pair is rejected whole, because a
// partially applied posture is exactly the "one switch, two meanings" confusion
// the two axes exist to remove. Extra properties are dropped (nothing else is
// ever stored). ⚠ It added "including any `at` the caller tried to supply, so a renderer cannot
// mint itself an arm that never expires" until 2026-08-20: there is no arm and no `at` — the
// single-use record is deleted (F-233) and what this validates is the DURABLE posture, which
// has no timestamp to forge. Dropping extra properties is still the rule; the reason is simply
// that nothing else is ever stored.
function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tools = typeof raw.tools === 'string' ? raw.tools : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (TOOL_MODES.indexOf(tools) === -1) return null;
  if (MESSAGE_MODES.indexOf(messages) === -1) return null;
  // ── ⚠ THE MODEL IS A THIRD FIELD AND IT IS NOT A THIRD AXIS (2026-08-22, Samuel's ruling) ──
  //
  // It rides the same record because it is the same decision — what the operator's own agent
  // starts as when they press Launch — but it is NOT permission. The two axes decide whether the
  // operator is ASKED; this decides which model answers. Nothing about containment reads it, and
  // it must never be folded into the pair the H2 argument is about.
  //
  // ⚠ IT VALIDATES SOFT, WHERE THE AXES VALIDATE HARD. An unknown TOOL or MESSAGE value rejects
  // the WHOLE write (a half-applied posture is the "one switch, two meanings" confusion the two
  // axes exist to remove); an unknown MODEL is simply ABSENT, which is the SDK default and is
  // exactly today's behaviour for every channel that has never chosen one. Failing the whole
  // write would mean a desktop that has not heard of a newer model could not store a posture at
  // all — refusing the permission pair over a model name is the wrong trade in both directions.
  // ⚠ AND ABSENT IS NOT A MEMBER: the key is OMITTED rather than written as '' or null, so a
  // record from before this field and a record whose model was cleared are the same record.
  const model = normalizeModelId(raw.model);
  return model
    ? { tools: tools, messages: messages, model: model }
    : { tools: tools, messages: messages };
}

// The restrictive pair every non-consenting launch shape gets. A helper rather
// than a bare literal so there is ONE spelling of "no posture was approved".
function defaultPreset() {
  return { tools: DEFAULT_PRESET.tools, messages: DEFAULT_PRESET.messages };
}

// ── THE DURABLE LAUNCH POSTURE (2026-08-20) ─────────────────────────────────
// A SECOND, SEPARATE pair with the same two axes and the OPPOSITE lifetime, and
// the difference is the whole point of both.
//
// ⚠ READ THE H2 BLOCK ABOVE BEFORE TOUCHING ANY OF THIS. What H2 forbids is not
// DURABILITY — it is an AMBIENT read at a spawn no human is attending.
// `session-engine.startSession` is the single construction site for every spawn
// shape, so a durable pair folded in THERE re-armed peer-driven wakes, crash
// resumes, recreated parked shells and requester auto-opens alike: bypass /
// auto_both chosen once became a standing, clickless grant for the channel.
//
// SO THE SPLIT IS BY CONSUMER, NOT BY LIFETIME, AND IT IS NOT NEGOTIABLE:
//   THE ARM (above)      single use, 30-min TTL, ONE consumer —
//                        `trigger.js › inboundApproved`, the consent-APPROVED
//                        responder launch. A peer's request; a human clicking
//                        Allow on a card they are looking at right now.
//   THIS POSTURE         durable, no TTL, ONE consumer —
//                        `channel-dir-ipc.js › sessions:launch`, the Agents
//                        tab's own button. The operator launching THEIR OWN
//                        agent onto THEIR OWN thread, with no peer involved and
//                        no consent row raised, because the click IS the
//                        consent.
//
// ⚠ NEITHER IS EVER READ BY `startSession` ITSELF. Both travel as `spec.startModes`,
// handed in per launch by a caller executing a decision a human is making right
// now; anything that passes nothing inherits the reducer's manual/ask. A bare
// recreate, reopen, resume or peer wake passes nothing and must keep passing
// nothing. `test/session-preset-start.test.mjs` pins that this module's
// `getLaunchPosture` appears in `channel-dir-ipc.js` and NOWHERE ELSE.
//
// WHY IT IS DURABLE AT ALL. It is rendered on the channel's SETTINGS tab beside
// the tool profile, the working folder and auto-send — all durable — and the
// single-use arm shown there was indistinguishable from a setting: the operator
// picked bypass, the first launch spent it (or 30 minutes passed), and every
// later session silently started manual/ask while the control still read
// "Bypass". A fuse rendered as a switch is worse than either.
//
// WHAT IT CANNOT DO. It is SUPERVISION, never CONTAINMENT: `bypass` is still
// bounded by the channel's tool profile and by session-profiles' SESSION_HARD_DENY,
// and Axis B still refuses to let ANY tool posture send a message. It is
// local-only (electron-store), never POSTed, never in a channel message.
// Default OFF-equivalent: an absent, corrupt or half-valid record reads
// manual/ask, the same restrictive floor an unset arm has.

// The channel's stored posture, or null when nothing valid is stored. ⚠ NO `at`
// and NO expiry check — that asymmetry with `readArmFrom` is the entire
// difference between the two records and must not be "tidied" into symmetry.
function readPostureFrom(map, channelId) {
  if (!map || !channelId) return null;
  return normalizePreset(map[channelId]);
}

// THE EFFECTIVE POSTURE AS THE RENDERER SEES IT — the stored pair or the restrictive default,
// and ALWAYS carrying a `model` key.
//
// ⚠ THE KEY IS PRESENT ON THE WAY OUT EVEN WHEN THE STORED RECORD OMITS IT, and that asymmetry
// with `readPostureFrom` is the whole point rather than an inconsistency to tidy away. STORAGE
// omits the key so a record from before this field and a record whose model was cleared are the
// same record (see `normalizePreset`). The WIRE cannot: the web's capability probe
// (`lib/permission-modes.ts › hasModelKey`) is an OWN-KEY test, and it reads a missing key as
// "this desktop has no model concept" and renders NO model row at all. Answering the pair alone
// therefore told every channel that had not already stored a model that the feature did not
// exist — and the only way to store one is the row that was never drawn. `model: null` is this
// build saying "I know the field; nothing is chosen; the SDK default applies", which is a
// different fact from silence (INVARIANTS §11 — UNKNOWN is not EMPTY).
function effectivePosture(map, channelId) {
  const stored = readPostureFrom(map, channelId);
  const base = stored || defaultPreset();
  return { tools: base.tools, messages: base.messages, model: (stored && stored.model) || null };
}

// Write the pair in place. { ok: false } and NO mutation when the id is missing
// or either axis is unknown — fail-closed, so a rejected write can never leave a
// half-applied posture behind.
function postureInto(map, channelId, raw) {
  const preset = normalizePreset(raw);
  if (!map || !channelId || !preset) return { ok: false };
  // ⚠ WRITTEN FIELD BY FIELD, never `{...preset}`: this is the boundary that guarantees nothing
  // but the validated members is ever stored, and a spread would carry whatever `normalizePreset`
  // grew next. `model` is omitted when absent (see above) so the stored shape is unchanged for
  // every channel that has not chosen one.
  map[channelId] = preset.model
    ? { tools: preset.tools, messages: preset.messages, model: preset.model }
    : { tools: preset.tools, messages: preset.messages };
  return { ok: true, preset: preset };
}

// ─── END CHANNEL-PREFS-VALIDATE ─────

// ── AUTO-SEND (2026-08-20, when the session window was deleted) — a DURABLE per-channel
// setting: it narrows nothing (it governs whether the operator's OWN agent's reply posts
// without a Send click), it is chosen on the channel's Settings tab, and it must survive
// restarts or the operator would re-opt-in per session.
// Default OFF — ask-first: an absent, corrupt, or non-boolean record reads false.
const AUTO_SEND_KEY = 'channelAutoSend'; // { [channelId]: true }

function getAutoSend(channelId) {
  if (!channelId) return false;
  const map = store.get(AUTO_SEND_KEY);
  return !!(map && typeof map === 'object' && map[channelId] === true);
}

function setAutoSend(channelId, on) {
  if (!channelId) return false;
  const map = store.get(AUTO_SEND_KEY);
  const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
  if (on === true) next[channelId] = true;
  else delete next[channelId];
  store.set(AUTO_SEND_KEY, next);
  diag('channel-prefs: autoSend', String(channelId).slice(0, 8), on === true ? 'on' : 'off');
  return on === true;
}

// ── Storage for the durable posture ─────────────────────────────────────────
const POSTURE_KEY = 'channelLaunchPosture'; // { [channelId]: { tools, messages } }

function getAllPostures() {
  const map = store.get(POSTURE_KEY);
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/**
 * THE EFFECTIVE launch posture for this channel — the stored pair, or the
 * restrictive default. ⚠ NEVER null, unlike `getPermissionPreset`: an arm that
 * is absent has NOT been chosen and the card must not claim it was, but a
 * durable setting that is absent IS manual/ask, and saying so is the truth.
 * Reading never writes.
 * ⚠ AND IT ALWAYS CARRIES `model` (2026-08-22) — `null` when none is stored. See
 * `effectivePosture` for why the WIRE shape and the STORED shape differ here.
 */
function getLaunchPosture(channelId) {
  return effectivePosture(getAllPostures(), channelId);
}

/**
 * Persist the channel's launch posture. { ok: true } only when BOTH axes
 * validated; an unknown value on either writes NOTHING.
 * ⚠ SPENT BY NOTHING. There is no consume twin on purpose — that is what makes
 * this the durable half of the split described above.
 */
function setLaunchPosture(channelId, raw) {
  const map = getAllPostures();
  const res = postureInto(map, channelId, raw);
  if (!res.ok) return { ok: false };
  store.set(POSTURE_KEY, map);
  diag('channel-prefs posture', String(channelId).slice(0, 8), res.preset.tools, res.preset.messages);
  return { ok: true, preset: res.preset };
}

/**
 * THE WINDOWLESS MESSAGE AXIS — ONE derivation, both windowless lanes.
 *
 * A windowless session has NO Accept UI, so the IN half is floored at
 * `auto_inbound` on every shape (INVARIANTS §11: the consent that admitted the
 * thread is the human decision, and a counterparty reply feeds as a turn). The
 * OUT half is the channel's durable auto-send switch, WIDENED — never narrowed —
 * by a picked posture that already says "send out".
 *
 * ⚠ ONE FUNCTION BECAUSE THE LANES MUST NOT DRIFT. `trigger.js ›
 * launchResponderSession` passes NULL (it said "derives it from the consumed ARM" until
 * 2026-08-20; the arm is deleted — F-233 — and that lane now supplies no posture at all), and
 * `session-ipc-ops.js › sessions:launch` passes the DURABLE posture. The inputs differ and the
 * rule does not; two copies of "does this pick mean auto-out" is how one lane starts posting
 * without the other.
 * ⚠ AND THERE IS A THIRD LANE SINCE 2026-08-20 (F-236): a mode set on a session ALREADY
 * RUNNING. It does not call this function — it has no channel and no auto-send to read — but it
 * must land on the same floor, so both defer to `session-profiles.js › floorWindowlessMessage`
 * and `test/session-mode-floor.test.mjs` pins the two against each other mode for mode.
 * ⚠ WIDEN-ONLY: there is no return value below `auto_inbound`. A posture of
 * `ask` cannot switch the floor off, because there is nothing to ask on.
 */
function windowlessMessageMode(channelId, picked) {
  const autoOut = getAutoSend(channelId) || picked === 'auto_outbound' || picked === 'auto_both';
  return autoOut ? 'auto_both' : 'auto_inbound';
}

/**
 * The `spec.startModes` for the OPERATOR'S OWN windowless launch (the Agents
 * tab's button) — the durable posture's tool axis, and the shared message
 * derivation above. The one place the durable posture becomes a spawn.
 */
function launchStartModes(channelId) {
  const posture = getLaunchPosture(channelId);
  return {
    tools: posture.tools,
    messages: windowlessMessageMode(channelId, posture.messages),
  };
}

/**
 * THE CHANNEL'S CHOSEN MODEL, as a full id, or '' for the SDK default (2026-08-22).
 *
 * ⚠ IT IS A SEPARATE READER FROM `getLaunchPosture` ON PURPOSE, AND THE REASON IS H2. That
 * function has exactly ONE consumer — `session-ipc-ops.js › sessions:launch`, the operator's own
 * click — and `test/session-preset-start.test.mjs` pins the count, because a second reader of the
 * stored PERMISSION pair re-opens the failure H2 exists to prevent (a posture reaching a spawn
 * nobody is attending). The MODEL is not that: it grants nothing, widens nothing, and reaches no
 * gate, so the PEER-TRIGGERED lane (`trigger.js`) may inherit it and must not be able to inherit
 * the pair alongside it. Two readers, so the census stays honest about which one is which.
 */
function getLaunchModel(channelId) {
  const posture = readPostureFrom(getAllPostures(), channelId);
  return (posture && posture.model) || '';
}

module.exports = {
  getAutoSend,
  setAutoSend,
  // The DURABLE launch posture — see the block above for why it is not the arm.
  readPostureFrom,
  effectivePosture, // 2026-08-22: the WIRE shape — the pair plus an always-present `model`
  postureInto,
  getLaunchPosture,
  setLaunchPosture,
  windowlessMessageMode,
  launchStartModes,
  getLaunchModel, // 2026-08-22: the model half, readable WITHOUT the permission pair
  TOOL_MODES,
  MESSAGE_MODES,
  DEFAULT_PRESET,
  normalizePreset,
  defaultPreset,
};

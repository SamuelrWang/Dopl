// Per-channel PERMISSION ARM — LOCAL ONLY, SINGLE USE, EXPIRING.
//
// The operator used to be able to set the session's two permission axes only
// AFTER the session window opened, which is after the agent already spawned. The
// pair stored here is chosen on the inbound consent card BEFORE Allow, so the
// launched session starts on exactly the posture the operator approved.
//
// THE TWO AXES (session-profiles.js is the authority on what each mode allows):
//   AXIS A  tools    = manual | accept_edits | auto | bypass
//   AXIS B  messages = ask | auto_inbound | auto_outbound | auto_both
// The default for a channel with nothing armed is the MOST RESTRICTIVE pair,
// { tools: 'manual', messages: 'ask' } — an absent, expired, or corrupt record
// can never read as more permissive than it is.
//
// ── H2 (2026-07-31): WHY THIS IS AN ARM AND NOT A SETTING ───────────────────
// It used to be a durable, channel-wide, permanent preference with no TTL, no
// delete and no expiry, and session-engine.startSession — the single
// construction site for EVERY spawn shape — folded it into the initial state
// unconditionally. So a posture the operator picked ONCE, on ONE consent card,
// silently re-armed every later session on that channel: a peer replying to any
// thread days later recreated a parked shell, which started at the stored
// bypass/auto_both, which made the inbound auto-accepted, which woke the agent —
// running with Bash/WebFetch pre-approved and auto-outbound posting, with NO
// consent card and NO click. Before that change every recreated shell started
// manual/ask.
//
// THE INVARIANT NOW, and it is not negotiable: a stored pair may only ever apply
// to a launch a human is ACTIVELY approving in that moment. Three mechanisms
// enforce it together, and each is sufficient to keep the failure above from
// recurring:
//   1. SINGLE USE — `consumePermissionPreset` returns the pair and DELETES it in
//      the same call. A second spawn on the same channel finds nothing.
//   2. EXPIRING — an arm older than ARM_TTL_MS is not consumable and is swept.
//      A Deny, a closed tab, or an ignored card leaves nothing behind that a
//      later launch could pick up.
//   3. ONE CONSUMER — only the consent-APPROVED launch path consumes it (see
//      trigger.js). A recreated parked shell, a crash resume, a wake, an
//      operator "Open session", and a requester launch all pass NOTHING, so
//      session-reducer's own hard-coded manual/ask defaults stand.
//
// CONSIDERED AND REJECTED: binding the arm to the specific consent ROW id would
// be tighter still, but the id would have to travel through the web card's IPC
// signature, and the web half already shipped — so that is a follow-up, not a
// blocker. The three mechanisms above already bound a hostile write to "pre-arm
// a posture a human must still explicitly Allow, on a card that shows it".
//
// SECURITY — the main window hosts REMOTE content (usedopl.com), so the renderer
// is NOT trusted with these values. Every write is re-validated HERE against the
// frozen enums above and rejected outright when either value is unknown; nothing
// but the two enum members and a timestamp is ever written. There is no
// free-text field, no path, and no id other than the channel's (the caller's
// channelId is UUID-gated AND sender-bound by channel-dir-ipc.js before it
// reaches this module).
//
// PRIVACY — the arm lives ONLY in the local electron-store. It is never POSTed to
// Dopl, never put in a channel message, and never leaves this machine. The local
// diag line carries the channel id PREFIX plus the two enum values, so a support
// log can explain a posture; there is no free text in it to leak.
//
// This module OWNS the storage + validation. The IPC surface that exposes it
// lives in channel-dir-ipc.js (the existing narrow bridge) so the privileged
// renderer-reachable handlers stay enumerable in one file.

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();
const PRESETS_KEY = 'channelPermissionPresets'; // { [channelId]: { tools, messages, at } }

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

// How long an arm stays consumable. Long enough for a real human flow (read the
// request, pick the posture, click Allow, let the consent watcher poll and the
// spawn start), short enough that a posture chosen and then abandoned cannot be
// picked up by something the operator has stopped thinking about. Expiry always
// fails RESTRICTIVE: the launch falls back to manual/ask.
const ARM_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Validate an arbitrary value into a preset, or null when it is not one. BOTH
// axes must be present and known: a half-valid pair is rejected whole, because a
// partially applied posture is exactly the "one switch, two meanings" confusion
// the two axes exist to remove. Extra properties are dropped (nothing else is
// ever stored) — including any `at` the caller tried to supply, so a renderer
// cannot mint itself an arm that never expires.
function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tools = typeof raw.tools === 'string' ? raw.tools : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (TOOL_MODES.indexOf(tools) === -1) return null;
  if (MESSAGE_MODES.indexOf(messages) === -1) return null;
  return { tools: tools, messages: messages };
}

// Is a stored record still consumable? Requires a valid pair AND a finite,
// non-future stamp within the TTL. A record with no `at` is a PRE-H2 durable
// preset written by an older build: it is deliberately treated as EXPIRED, so
// upgrading can only ever narrow a posture, never silently re-arm one the
// operator set under the old always-on semantics. A stamp in the FUTURE (clock
// skew, a tampered store) is refused too, rather than granted an unbounded life.
function armIsLive(stored, now) {
  if (!normalizePreset(stored)) return false;
  const at = stored.at;
  if (!Number.isFinite(at) || at > now) return false;
  return now - at < ARM_TTL_MS;
}

// The pair to actually launch with, from a stored record — or null when there is
// nothing live. Read path only; it never rewrites a corrupt record.
function resolveArm(stored, now) {
  return armIsLive(stored, now) ? normalizePreset(stored) : null;
}

// The restrictive pair every non-consenting launch shape gets. A helper rather
// than a bare literal so there is ONE spelling of "no posture was approved".
function defaultPreset() {
  return { tools: DEFAULT_PRESET.tools, messages: DEFAULT_PRESET.messages };
}

// ── Map-level ops (the store is just a plain object of these) ────────────────
// Kept inside the pure block so PER-CHANNEL ISOLATION is unit-tested: a write to
// one channel touches that key and nothing else, and a read for a channel with no
// record is null rather than a neighbour's posture.

// The channel's live arm, or null when nothing consumable is stored for it.
function readArmFrom(map, channelId, now) {
  if (!map || !channelId) return null;
  return resolveArm(map[channelId], now);
}

// Write the pair into the map IN PLACE, stamped `now`. { ok: false } (and NO
// mutation at all) when the id is missing or either axis is unknown — fail-closed,
// so a rejected write can never leave a half-applied posture behind.
function armInto(map, channelId, raw, now) {
  const preset = normalizePreset(raw);
  if (!map || !channelId || !preset) return { ok: false };
  map[channelId] = { tools: preset.tools, messages: preset.messages, at: now };
  return { ok: true, preset: preset };
}

// SINGLE USE: take the live arm and REMOVE it, in one step. Returns the pair or
// null. The delete happens even when the record was expired/corrupt, so a read is
// also the sweep for the key it touched.
function takeArmFrom(map, channelId, now) {
  if (!map || !channelId) return null;
  const found = resolveArm(map[channelId], now);
  if (Object.prototype.hasOwnProperty.call(map, channelId)) delete map[channelId];
  return found;
}

// Drop every expired/invalid record. Returns true when the map changed, so the
// caller only writes the store when there is something to write (F-072 spirit:
// no pointless writes on a read path).
function sweepExpired(map, now) {
  let changed = false;
  for (const id of Object.keys(map || {})) {
    if (!armIsLive(map[id], now)) {
      delete map[id];
      changed = true;
    }
  }
  return changed;
}
// ─── END CHANNEL-PREFS-VALIDATE ─────

// ── Storage (electron-store; never leaves the machine) ───────────────────────
function getAllPresets() {
  const map = store.get(PRESETS_KEY);
  return map && typeof map === 'object' ? map : {};
}

function writeAll(map) {
  store.set(PRESETS_KEY, map);
}

// The channel's live arm, or null when nothing consumable is stored. null is the
// signal the web card uses to show the defaults without claiming they were
// chosen. Reading NEVER extends the arm and never writes.
function getPermissionPreset(channelId) {
  return readArmFrom(getAllPresets(), channelId, Date.now());
}

// ARM a pair for the NEXT consent-approved launch on this channel. Returns
// { ok: true } only when BOTH axes validated; an unknown value on either axis
// writes NOTHING (the store is not touched) and reports { ok: false }.
function armPermissionPreset(channelId, raw) {
  const now = Date.now();
  const map = getAllPresets();
  const res = armInto(map, channelId, raw, now);
  if (!res.ok) return { ok: false };
  // Opportunistic sweep — this is already a write path, and the entry armInto
  // just stamped is live, so it survives its own sweep.
  sweepExpired(map, now);
  writeAll(map);
  diag('channel-prefs armed', String(channelId).slice(0, 8), res.preset.tools, res.preset.messages);
  return { ok: true };
}

// THE ONLY WAY A STORED POSTURE EVER REACHES A SPAWN. Returns the live pair and
// deletes it, or null. Call this ONLY from a path where a human is approving
// this specific launch right now (trigger.js's consent-approved responder
// launch); every other spawn shape must pass nothing and inherit manual/ask.
function consumePermissionPreset(channelId) {
  const now = Date.now();
  const map = getAllPresets();
  const found = takeArmFrom(map, channelId, now);
  sweepExpired(map, now);
  writeAll(map);
  if (found) diag('channel-prefs consumed', String(channelId).slice(0, 8), found.tools, found.messages);
  return found;
}

// Explicit teardown: a Deny (or any decision that is not an approval) drops the
// arm rather than leaving it to age out, so a refused request never leaves a
// widened posture waiting for the next one.
function clearPermissionPreset(channelId) {
  const now = Date.now();
  const map = getAllPresets();
  const had = Object.prototype.hasOwnProperty.call(map, channelId || '');
  if (channelId) delete map[channelId];
  const swept = sweepExpired(map, now);
  if (had || swept) writeAll(map);
  if (had) diag('channel-prefs cleared', String(channelId).slice(0, 8));
}

module.exports = {
  TOOL_MODES,
  MESSAGE_MODES,
  DEFAULT_PRESET,
  ARM_TTL_MS,
  normalizePreset,
  armIsLive,
  resolveArm,
  defaultPreset,
  readArmFrom,
  armInto,
  takeArmFrom,
  sweepExpired,
  getAllPresets,
  getPermissionPreset,
  armPermissionPreset,
  consumePermissionPreset,
  clearPermissionPreset,
};

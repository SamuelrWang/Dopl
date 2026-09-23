// THE PRE-U5 LAUNCH POSTURE — THE LEGACY READER, AND IT IS SCHEDULED FOR DELETION.
//
// ⚠ **§1 SPLIT OUT OF `launch-selection.js` (2026-09-21, U5), AND THE SEAM IS A LIFETIME.**
// Everything in this file describes the record shape that shipped BEFORE the runtime-keyed launch
// selection: one global tool mode in the DEFAULT runtime's words, one messaging axis, and a
// runtime pick stored somewhere else entirely. It exists for exactly two jobs and acquires no
// third:
//
//   MIGRATION   `launch-selection.js › fromLegacy` reads a record already on disk once, moves its
//               tool mode into the DEFAULT runtime's record untranslated, and never writes here.
//   THE MIRROR  `channel-prefs.js › setLaunchSelection` re-derives this pair on every write so a
//               DOWNGRADED build reads the settings actually in force, and every renderer older
//               than U5 keeps the OWN KEYS its capability probes look for.
//
// ⚠ **A STORED `model` IS IGNORED SINCE 2026-09-23** (Samuel: *"We don't need a pin model in the
// settings"*). Records on disk may still carry one; it is dropped on read and never written back.
//
// ⚠ **IT IS NEVER CONSULTED FOR A LAUNCH, AND IT MUST NOT GROW A FIELD.** A new setting added
// here is a setting that exists in one runtime's vocabulary for every runtime, which is the whole
// class of bug U5 removed (`docs/REFACTOR-FINDINGS.md` F-390). When the compatibility window
// closes, this file is deleted whole — which is why it is a file and not a block.
//
// ⚠ THE ONE FROZEN VOCABULARY LEFT IN SHARED STORAGE IS HERE, DELIBERATELY AND VISIBLY. The
// records it reads were written in those four words; a migration that could not read them would
// not be a migration.

// ─── BEGIN CHANNEL-PREFS-VALIDATE (pure; unit-tested via source extraction) ──
// No electron/fs/store/require refs below, so test/_channel-prefs-block.mjs can
// slice this block and evaluate it verbatim (same pattern as CHANNEL-DIR-RESOLVE).
//
// ⚠ THIS IS THE LEGACY READER (2026-09-21, U5). Everything in it describes the pre-U5 record —
// one global tool mode, the default runtime's vocabulary — and it survives for exactly two jobs:
// MIGRATING a record already on disk, and answering the LEGACY WIRE SHAPE that a renderer older
// than U5 still feature-probes. The LAUNCH-SELECTION fence below is what a write goes through. Do
// not add a field here.

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
// the two axes exist to remove. Extra properties — a legacy `model` included —
// are dropped (nothing else is ever stored).
function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tools = typeof raw.tools === 'string' ? raw.tools : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (TOOL_MODES.indexOf(tools) === -1) return null;
  if (MESSAGE_MODES.indexOf(messages) === -1) return null;
  return { tools: tools, messages: messages };
}

// The restrictive pair every non-consenting launch shape gets. A helper rather
// than a bare literal so there is ONE spelling of "no posture was approved".
function defaultPreset() {
  return { tools: DEFAULT_PRESET.tools, messages: DEFAULT_PRESET.messages };
}

// The channel's stored LEGACY posture, or null when nothing valid is stored.
function readPostureFrom(map, channelId) {
  if (!map || !channelId) return null;
  return normalizePreset(map[channelId]);
}

// THE LEGACY POSTURE AS THE RENDERER SEES IT — the stored pair or the restrictive default.
// ⚠ NO `model` KEY SINCE 2026-09-23: its absence is what makes the web's own-key probe
// (`lib/permission-modes.ts › hasModelKey`) draw no Model row.
function effectivePosture(map, channelId) {
  const base = readPostureFrom(map, channelId) || defaultPreset();
  return { tools: base.tools, messages: base.messages };
}

// Write the LEGACY pair in place. { ok: false } and NO mutation when the id is missing
// or either axis is unknown — fail-closed, so a rejected write can never leave a
// half-applied posture behind.
function postureInto(map, channelId, raw) {
  const preset = normalizePreset(raw);
  if (!map || !channelId || !preset) return { ok: false };
  // ⚠ WRITTEN FIELD BY FIELD, never `{...preset}`: this is the boundary that guarantees nothing
  // but the validated members is ever stored, and a spread would carry whatever `normalizePreset`
  // grew next.
  const next = { tools: preset.tools, messages: preset.messages };
  map[channelId] = next;
  // ⚠ THE ANSWER IS WHAT WAS STORED, not what was asked for.
  return { ok: true, preset: next };
}

// ─── END CHANNEL-PREFS-VALIDATE ─────

module.exports = {
  TOOL_MODES,
  MESSAGE_MODES,
  DEFAULT_PRESET,
  normalizePreset,
  defaultPreset,
  readPostureFrom,
  effectivePosture,
  postureInto,
};

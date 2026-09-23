// DEFAULT AGENT SETTINGS — the pair, the runtime (and its containment setting) and the chaining
// flag a NEWLY CREATED channel starts with. LOCAL ONLY, never sent to Dopl (2026-09-18, Samuel's
// ruling: "profile popup gets an Agents tab; new channels inherit it instead of the hardcoded
// blanks").
// ⚠ **NO MODEL SINCE 2026-09-23** (Samuel: *"We don't need this model, channel, and profile
// settings"*): the record stores none and seeds none — `launch-selection.js ›
// normalizeRuntimeRecord` drops a legacy one on read.
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
// own posture record, once, at or right after the moment that channel is created. Every later
// read is the per-channel record, through the one consumer that already existed. **Do not wire
// `getAgentDefaults` into `session-engine.js`, into any launch path, or into `getLaunchPosture`'s
// fallback** — a defaults record consulted at spawn time is an ambient posture read at a spawn no
// human is attending, which is exactly what H2 forbids, and it would additionally re-point every
// EXISTING channel at a value its operator set for new ones.
//
// ⚠ **THERE ARE TWO SEED SITES SINCE 2026-09-22, AND THE SECOND IS NOT A SECOND READER.** Until
// then the only one was a RENDERER executing a creation a human had just performed, and the plan's
// Handoff item 3 recorded "agent-created channels do not inherit" as a RULING. Samuel REVERSED it
// (*"Agent created channels should inherit defaults"*). A channel created over MCP is created
// server-side with no renderer to run, so `main/channel-seed-watch.js` seeds it from the reconcile
// pass that first OBSERVES it — still a WRITE into that channel's own posture, still through
// `seedChannel`, still on the operator's own machine (the record is never sent to Dopl), and still
// gated so a channel that existed before the feature can never be reached. Its header carries the
// first-seen watermark argument; `test/session-posture-writers.test.mjs` admits it by NAME.
//
// ⚠ AND THAT IS ALSO WHY THE SEED IS WRITE-ONCE PER CHANNEL. `seedChannel` refuses when the
// channel already has a stored posture, so a re-created row, a retry, or a second renderer racing
// the same creation cannot rewrite a channel the operator has since configured. "Existing
// channels untouched" is a property of this function, not of who calls it.
//
// SECURITY — every write is re-validated here against the frozen enums below, the same hard/soft
// split `channel-prefs.js › normalizePreset` uses: an unknown value on either AXIS rejects the
// whole write, an unknown RUNTIME is simply absent (a MODEL is never stored). Nothing but the
// validated members is ever stored; there is no free-text field and no path.
//
// PRIVACY — local electron-store only. Never POSTed to Dopl, never in a channel message, never
// off this machine. The diag line carries the two enum values and nothing else.

const Store = require('electron-store');
// ⚠ **`require('./session-model')` LEFT ON 2026-09-21 (U5), AND THAT REMOVAL IS THE UNIT.** This
// file validated the defaults record's MODEL against the DEFAULT runtime's frozen id list, so an
// operator whose default runtime was Codex could not store a Codex model at all — the write was
// simply dropped as "unknown". The vocabulary lives behind each adapter's own descriptor now and
// the shape lives in `main/launch-selection.js`; both arrive through the registry below.
const selection = require('./launch-selection');
const runtimeRegistry = require('./runtime');
const channelPrefs = require('./channel-prefs');
const { diag } = require('./diag');

const store = new Store();

const ctx = () => runtimeRegistry.selectionContext();

// ─── BEGIN AGENT-DEFAULTS-VALIDATE (pure; unit-tested via source extraction) ──
// No electron/fs/store/require refs below, so test/agent-defaults.test.mjs can slice this block
// and evaluate it verbatim. Every runtime vocabulary arrives through the injected `sel` (the
// `main/launch-selection.js` module) and `ctx` (the adapter vocabulary), which is what keeps it
// pure — and, since U5, what keeps ONE runtime's enums out of another runtime's validation.

/**
 * Validate an arbitrary value into a defaults record, or null when it is not one.
 *
 * ⚠ **IT IS A LAUNCH SELECTION PLUS ONE FLAG.** The defaults record and a channel's record now
 * answer the same question in the same shape — which runtime, which messaging, and which tool +
 * native settings PER RUNTIME — because `seedChannel` copies one into the other. Two shapes for
 * one copy is how a field comes to be seeded on some channels and not others.
 *
 * ⚠ THE THREE DISCIPLINES THIS TREE ALREADY USES, UNCHANGED IN DIRECTION:
 *  · MESSAGING is Dopl's own axis and validates HARD — an unknown value rejects the whole record,
 *    because a partially applied record is the "one switch, two meanings" confusion the axes exist
 *    to remove;
 *  · the RUNTIME-KEYED half validates SOFT and FAIL-CLOSED — an unknown MODE or NATIVE value
 *    falls to that adapter's NARROWEST, never to its widest and never to unrestricted (and a
 *    `model` is not stored at all since 2026-09-23);
 *  · `agentChain` is `=== true` and nothing else, because it lifts a bound.
 * Extra properties are dropped; nothing else is ever stored.
 *
 * ⚠ A LEGACY RECORD MIGRATES IN PLACE. A pre-U5 `{tools, messages, agentChain, model?, runtime?}`
 * has no `v`, so it is read through `sel.fromLegacy` — its global `tools` lands in the DEFAULT
 * runtime's record untranslated, exactly as a channel's does, and its `model` is dropped.
 */
function normalizeDefaults(sel, ctx, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const legacy = raw.v == null;
  const res = legacy
    ? sel.fromLegacy(ctx, { tools: raw.tools, messages: raw.messages }, raw.runtime)
    : sel.normalizeSelection(ctx, raw);
  // ⚠ THE HARD HALF, ASKED OF THE INPUT RATHER THAN OF THE RESULT. `normalizeSelection` FLOORS an
  // unknown messaging value to `ask` and says so in its review; this record's contract is that such
  // a write is REJECTED WHOLE, so the check has to look at what was asked for.
  const asked = typeof raw.messages === 'string' ? raw.messages : '';
  if (sel.SELECTION_MESSAGE_MODES.indexOf(asked) === -1) return null;
  return {
    v: res.selection.v,
    runtime: res.selection.runtime,
    messages: legacy ? asked : res.selection.messages, // a legacy record migrates its messages even when its tools do not
    byRuntime: res.selection.byRuntime,
    agentChain: raw.agentChain === true,
  };
}

/**
 * The record as the RENDERER sees it — the stored one or the factory answer, and ALWAYS carrying
 * `runtime`, `tools`, `byRuntime` and `v` keys. ⚠ NO `model` KEY SINCE 2026-09-23 — its absence
 * is what makes an older renderer's `hasModelKey` probe draw no Model row.
 *
 * ⚠ THE LEGACY KEYS ARE PRESENT ON THE WAY OUT EVEN THOUGH STORAGE HOLDS THEM PER RUNTIME, and
 * that asymmetry is the point rather than an inconsistency to tidy away. The web's capability
 * probes (`lib/permission-modes.ts › hasModelKey`, `lib/runtime-capability.ts › hasRuntimeKey`) are
 * OWN-KEY tests, and a missing key reads as "this desktop has no such concept" — which renders NO
 * row, and the only way to store a value is the row that was never drawn. So `tools` answers the
 * SELECTED runtime's value, in that runtime's own words.
 * ⚠ `v` AND `byRuntime` ARE ADDITIVE AND ARE THE CAPABILITY FIELDS U5 ASKS REPLIES TO CARRY: a
 * renderer that knows about them reads the whole per-runtime truth, and one that does not sees the
 * shape it always saw.
 */
function effectiveDefaults(sel, ctx, stored) {
  const base = stored || { ...sel.emptySelection(), agentChain: false };
  const rec = sel.activeRecord(ctx, base);
  return {
    tools: rec.tools || ctx.narrowestToolFor(base.runtime),
    messages: base.messages,
    agentChain: base.agentChain === true,
    runtime: base.runtime || '',
    v: base.v,
    byRuntime: base.byRuntime,
    native: rec.native ? { ...rec.native } : {},
  };
}

/**
 * The HARD failures in a defaults WRITE: a registered runtime's non-empty `tools` that runtime
 * does not offer. A read floors such a value; a write refuses it, like a channel write (P3-29).
 */
function defaultsRejections(sel, ctx, raw) {
  const by = raw && raw.byRuntime && typeof raw.byRuntime === 'object' && !Array.isArray(raw.byRuntime)
    ? raw.byRuntime : {};
  const out = [];
  for (const id of Object.keys(by)) {
    const tools = by[id] && typeof by[id].tools === 'string' ? by[id].tools.trim() : '';
    if (!tools || !ctx.known(id)) continue;
    for (const line of sel.patchRejections(ctx, { runtime: id }, { tools: tools })) out.push(line);
  }
  return out;
}

// ─── END AGENT-DEFAULTS-VALIDATE ─────

const DEFAULTS_KEY = 'agentDefaults'; // { v, runtime, messages, byRuntime, agentChain }

function normalizeStored(raw) {
  return normalizeDefaults(selection, ctx(), raw);
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
  return effectiveDefaults(selection, ctx(), readStored());
}

/**
 * Persist the defaults. `{ ok: false }` and NO mutation when either axis is unknown — fail-closed,
 * so a rejected write can never leave a half-applied record behind.
 *
 * ⚠ THE WHOLE RECORD IS REWRITTEN, so a caller that omits `runtime` CLEARS it. That is
 * the opposite of `channel-prefs.js › postureInto`'s carry-through rule and it is deliberate:
 * there is exactly ONE surface writing this record (the profile popup's Agents tab), it always
 * sends the whole record, and there is no second control that could drop a field it does not know
 * about. If a second writer ever appears, port the `hasOwnProperty` idiom before it ships.
 */
function setAgentDefaults(raw) {
  const rejected = defaultsRejections(selection, ctx(), raw);
  if (rejected.length) {
    diag('agent-defaults: refused a write —', rejected.join('; '));
    return { ok: false, rejected: rejected };
  }
  const next = normalizeStored(raw);
  if (!next) return { ok: false };
  try {
    store.set(DEFAULTS_KEY, next);
  } catch (err) {
    diag('agent-defaults: could not persist —', err && err.message);
    return { ok: false };
  }
  diag('agent-defaults', next.runtime || '(default)', next.messages,
    next.agentChain ? 'chain' : 'no-chain');
  return { ok: true, defaults: effectiveDefaults(selection, ctx(), next) };
}

/**
 * SEED A NEWLY CREATED CHANNEL FROM THE DEFAULTS — the one and only inheritance MECHANISM, now
 * reached from two places: the renderer's creation success path (`channels:applyAgentDefaults`)
 * and `main/channel-seed-watch.js`, for a creation no renderer executed. ⚠ THE SECOND CALLER
 * CHANGED NOTHING BELOW, deliberately: "which channels may be seeded" is that module's question
 * and "may THIS channel be rewritten" is this function's, and keeping them apart is what makes
 * "existing channels untouched" a property of the code rather than of a caller's discipline.
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
  const stored = readStored();
  // ⚠ A MACHINE WITH NO DEFAULTS RECORD SEEDS NOTHING. `getAgentDefaults` answers the factory
  // record so the Agents tab has something to render, but writing it into a channel would stamp
  // every new room with a posture nobody chose — and the channel resolves to exactly the same
  // restrictive settings when it is unset. `seeded: false` is the honest answer.
  if (!stored) return { ok: true, seeded: false };
  // ⚠ **THE WHOLE SELECTION IS COPIED, EVERY RUNTIME'S RECORD INCLUDED (2026-09-21, U5).** The
  // pre-U5 seed copied one global tool mode and the runtime pick; a new channel therefore LOST the
  // Codex sandbox setting configured on the same tab. Decisions #1 and #2 say both sets are
  // remembered and neither is translated, so the seed carries both. (No model is seeded since
  // 2026-09-23 — none is stored.)
  // ⚠ STILL ONE WRITE THROUGH ONE VALIDATING WRITER, which re-validates every field against the
  // selected adapter on arrival — the defaults record is not a trusted source, it is just another
  // stored record.
  const res = channelPrefs.setLaunchSelection(channelId, {
    runtime: stored.runtime,
    messages: stored.messages,
    byRuntime: stored.byRuntime,
  });
  if (!res || res.ok !== true) return { ok: false, seeded: false };
  // ⚠ AFTER THE SELECTION AND ONLY ON A SUCCESSFUL ONE, the order `channels:setLaunchPosture`
  // already uses: a rejected write must never half-apply a bound.
  if (stored.agentChain) channelPrefs.setAgentChain(channelId, true);
  diag('agent-defaults: seeded', String(channelId).slice(0, 8),
    stored.runtime || '(default)', stored.messages);
  return { ok: true, seeded: true };
}

module.exports = {
  getAgentDefaults,
  setAgentDefaults,
  seedChannel,
};

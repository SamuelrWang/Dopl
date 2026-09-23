// THE DURABLE LAUNCH SELECTION — what an agent starts as, as a VERSIONED, RUNTIME-KEYED record.
//
// ⚠ **§1 SPLIT OUT OF `channel-prefs.js` (2026-09-21, U5), AND IT IS A SPLIT BY REASON TO CHANGE,
// NOT A SPACE-MAKING MOVE.** That file changes when a CHANNEL PREFERENCE moves — chaining, the
// store keys, which IPC op may write. This file changes when the SHAPE of a stored selection
// changes: its version, what migrates into it, what a version this build cannot read falls back
// to. Those clocks had already come apart (the file was at 499 of its 500 lines with three
// preferences and one record shape in it); U5 is the wave that made the record shape move.
// `channel-prefs.js` re-exports every name below, so no caller moved — the same idiom
// `orchestrator-consent.js` and `identity-approval.js` set.
//
// ── ⚠ WHY A RUNTIME-KEYED RECORD EXISTS AT ALL ───────────────────────────────────────────────
//
// The record this replaces was `{ tools, messages, model }` plus a SEPARATE `channelRuntime` key,
// and every field in it was validated against the DEFAULT runtime's enums:
//
//   · `tools` was checked against `['manual','accept_edits','auto','bypass']` — Claude's Axis-A
//     words. A channel whose operator had selected Codex still stored Claude's vocabulary and the
//     Settings row's write was REFUSED off the default runtime (`docs/REFACTOR-FINDINGS.md` F-390).
//   · `model` was checked against Claude's frozen id list, so a Codex id could not be stored at
//     all; and in `session-engine.js` it was coerced through Claude's ALIAS table, which turned any
//     Codex id into the literal string `'default'` on its way to the Codex launch spec.
//   · picking a runtime therefore had to CLEAR the stored model (`channel-runtime.js`, 2026-09-06),
//     because one global model field cannot hold two rosters.
//
// ⚠ **THE TWO RULINGS THE SHAPE ENCODES, AND NEITHER IS NEGOTIABLE.** Claude's and Codex's native
// settings are stored SEPARATELY and are NEVER translated into one another. (Their MODEL choices
// were stored the same way until 2026-09-23, when Samuel removed the stored model outright — a
// launch's model is the launcher's pick, the identity's, or the runtime default; see
// `normalizeRuntimeRecord`.) `Accept edits` is not a Codex approval mode — Codex separates approval policy from
// sandbox containment, and `granular` has no Claude equivalent — so a switch Claude → Codex →
// Claude must restore BOTH remembered sets rather than mapping, clearing or reinterpreting either.
// That is what `byRuntime` is: one record per runtime, side by side, and the selected runtime says
// which one is active.
//
// ── ⚠ WHAT THIS MODULE MAY NOT KNOW ──────────────────────────────────────────────────────────
//
// It holds NO runtime's vocabulary. Every mode and native setting is validated through
// an injected context (`main/runtime/index.js › selectionContext`) that resolves the SELECTED
// adapter's own descriptor. The verification bar U5 sets is exactly this: **no shared storage or
// session-core path imports one runtime's model/tool enums to validate another runtime's launch.**
//
// The one exception is fenced and labelled: the LEGACY block below still carries the frozen
// `['manual','accept_edits','auto','bypass']` list, because that is the vocabulary the records
// already on disk were written in and a migration has to be able to read what is there. It is a
// READER for one compatibility window and it is never consulted for a launch.
//
// SECURITY — every write is re-validated here, in main, against the selected adapter. A renderer
// one version ahead cannot smuggle a runtime id this build does not register, a mode outside the
// selected adapter's declared options, or a native setting the adapter cannot spend (a model id
// is not stored at all). Nothing but validated members is ever stored; there is
// no free-text field and no path.
//
// PRIVACY — the CALLER owns storage (`channel-prefs.js`, `agent-defaults.js`); this module is
// pure. Nothing here reads a store, a file, the environment or the network.

// ⚠ **THE LEGACY POSTURE READER LIVES IN `main/launch-posture-legacy.js` (§1 split, U5)**, and
// the seam is a LIFETIME rather than a topic: that file is deleted whole when the compatibility
// window closes, and it is the only place in shared storage that still holds a frozen vocabulary.
// Re-exported below, so no caller and no suite moved.
// ⚠ THIS FILE ITSELF REQUIRES NOTHING ELSE. Every runtime vocabulary arrives through the injected
// `ctx`, which is what keeps the block below sliceable and what keeps ONE runtime's enums out of
// another runtime's validation.
const legacy = require('./launch-posture-legacy');


// ─── BEGIN LAUNCH-SELECTION (pure; unit-tested via source extraction) ────────
// No electron/fs/store/require refs below. Every runtime vocabulary arrives through the injected
// `ctx` (`main/runtime/index.js › selectionContext`), so this block can be sliced and driven
// against fake adapters — and, more importantly, so it cannot grow a dependency on one vendor's
// enums, which is the failure the whole unit exists to remove.

// ⚠ **THE VERSION IS A FIELD ON THE RECORD, NOT A STORE KEY, AND IT IS READ BEFORE ANYTHING
// ELSE.** A build that meets a version it does not understand must not guess at the fields it
// happens to recognise: `v: 3` could mean `messages` has a fifth member or that `byRuntime`'s
// values changed shape, and reading it as a v2 record is how a widened setting arrives silently.
// `› normalizeSelection` therefore answers the RESTRICTIVE selection plus a review sentence.
const SELECTION_VERSION = 2;

// ⚠ **DOPL'S OWN AXIS, AND THE ONE VOCABULARY THAT DOES NOT MOVE WITH THE RUNTIME.** Dopl — not
// either vendor — gates channel delivery, so this list is core's on every adapter. It is spelled
// here rather than imported from the legacy fence because the two lists AGREE and must be able to
// stop agreeing: the legacy one describes what is on disk, this one describes what may be written.
const SELECTION_MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

/** The selection a channel nobody has configured resolves to. ⚠ The restrictive one. */
function emptySelection() {
  return {
    v: SELECTION_VERSION,
    runtime: '', // '' = the default adapter (`runtime/index.js › resolve`), never "no runtime"
    messages: SELECTION_MESSAGE_MODES[0],
    byRuntime: {},
  };
}

/**
 * The per-runtime half of a selection — `{ tools?, native? }` — validated against THAT runtime's
 * own descriptor.
 *
 * 🔓 **NO `model` AND NO MODEL-SCOPED `native` KEY SINCE 2026-09-23 (Samuel: *"We don't need a pin
 * model in the settings"*).** A launch's model is the LAUNCHER's pick, else the identity's, else
 * the runtime's own default (`session-launch.js › launch`) — never a channel's or a profile's
 * stored one. So a stored `model`, and a stored native key the runtime declares as a MODEL
 * dimension (Codex's `reasoningEffort`), are DROPPED here SILENTLY: an old record reads
 * harmlessly and the next write strips it. ⚠ Not reviewed — nothing narrowed, so there is nothing
 * for an operator to act on. ⚠ The CONTAINMENT native axis (Codex's sandbox) is unchanged.
 *
 * ⚠ EVERY FIELD IS OMITTED WHEN ABSENT, never written as `''`/`null`/`{}`. A record from before a
 * field and a record whose field was cleared must be the SAME record, so no reader can grow a
 * third state to get wrong — the rule the legacy posture, the runtime pick and the chaining flag
 * all already follow.
 * ⚠ `tools` FAILS CLOSED TO THE ADAPTER'S NARROWEST MODE, NOT TO ABSENCE, WHEN IT IS PRESENT AND
 * UNRECOGNISED. Absence means "this runtime has no pick, use its declared default"; an unreadable
 * pick is a value somebody stored that this build cannot honour, and the plan's scope boundary is
 * explicit that such a value resolves to the narrowest supported behaviour and surfaces a
 * recoverable state. It must NEVER resolve to the widest, and it must never resolve to
 * unrestricted as a migration fallback.
 */
function normalizeRuntimeRecord(ctx, runtimeId, raw) {
  const review = [];
  const out = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const label = ctx.labelFor(runtimeId);

  if (Object.prototype.hasOwnProperty.call(src, 'tools')) {
    const asked = typeof src.tools === 'string' ? src.tools.trim() : '';
    if (asked) {
      const coerced = ctx.toolModeFor(runtimeId, asked);
      if (coerced) out.tools = coerced;
      if (coerced && coerced !== asked) {
        review.push(`${label} does not offer the tool setting "${asked}"; it fell back to its `
          + `narrowest, "${coerced}"`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(src, 'native')) {
    const res = ctx.nativeFor(runtimeId, withoutModelDimensions(ctx, runtimeId, src.native));
    if (Object.keys(res.value).length) out.native = res.value;
    for (const line of res.review) review.push(line);
  }

  return { record: out, review: review };
}

/** The native bag minus every key the runtime declares as a MODEL dimension — see above. */
function withoutModelDimensions(ctx, runtimeId, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const modelDims = ctx.modelDimensionsFor(runtimeId);
  const out = {};
  for (const key of Object.keys(raw)) if (modelDims.indexOf(key) === -1) out[key] = raw[key];
  return out;
}

/**
 * Validate an arbitrary value into a SELECTION, with the sentences an operator needs.
 *
 * Answers `{ selection, review, stored }` — `stored` is false when nothing valid was on disk, so a
 * caller can tell "never configured" from "configured and read back".
 *
 * ⚠ THE FOUR CASES, AND THEY ARE FOUR DIFFERENT ANSWERS:
 *   ABSENT            the restrictive selection, NO review. An unset channel really is manual/ask,
 *                     and saying so is the truth rather than a fault.
 *   CURRENT VERSION   validated field by field against each runtime's own descriptor.
 *   FUTURE VERSION    the restrictive selection, the RUNTIME PICK PRESERVED, and a review. The
 *                     pick survives because choosing a runtime WIDENS NOTHING — every adapter
 *                     re-derives its own deny lists and Axis-A vocabulary, and the four gate steps
 *                     ahead of Axis A are core's on all of them (`channel-runtime.js`'s header is
 *                     the one spelling of that argument) — so keeping it strands nobody and moves
 *                     no operator to another vendor. Everything a future version might have
 *                     re-meant is dropped.
 *   MALFORMED         the restrictive selection and a review. Same direction, no preserved pick.
 *
 * ⚠ **NEVER UNRESTRICTED AS A FALLBACK**, in any of the four. That is the plan's scope boundary
 * and it is the reason the restrictive answer is built from `emptySelection()` rather than from
 * whatever fields happened to parse.
 */
function normalizeSelection(ctx, raw) {
  if (raw == null) return { selection: emptySelection(), review: [], stored: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      selection: emptySelection(),
      review: ['the stored launch settings could not be read, so the most restrictive ones apply'],
      stored: false,
    };
  }
  const version = Number(raw.v);
  if (!Number.isFinite(version) || version !== SELECTION_VERSION) {
    const restrictive = emptySelection();
    const line = version > SELECTION_VERSION
      ? `these launch settings were written by a newer version of Dopl (record v${version}); `
        + `this build reads v${SELECTION_VERSION}, so the most restrictive settings apply until `
        + 'they are set again here'
      : 'the stored launch settings are not in a shape this build recognises, so the most '
        + 'restrictive ones apply';
    if (version > SELECTION_VERSION && ctx.known(raw.runtime)) restrictive.runtime = raw.runtime;
    return { selection: restrictive, review: [line], stored: false };
  }

  const out = emptySelection();
  const review = [];
  // ⚠ AN UNREGISTERED RUNTIME READS AS THE DEFAULT AND IS NOT REPAIRED. A downgrade must not
  // silently throw the operator's pick away — re-upgrade and it is still there — and it must not
  // strand the channel either (`channel-runtime.js › getChannelRuntime`, unchanged rule).
  out.runtime = ctx.known(raw.runtime) ? raw.runtime : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (SELECTION_MESSAGE_MODES.indexOf(messages) === -1) {
    if (messages) {
      review.push(`"${messages}" is not a messaging setting this build knows; messaging fell back `
        + `to "${SELECTION_MESSAGE_MODES[0]}"`);
    }
  } else {
    out.messages = messages;
  }

  const by = foldDefaultKey(ctx, raw.byRuntime && typeof raw.byRuntime === 'object' && !Array.isArray(raw.byRuntime)
    ? raw.byRuntime
    : {});
  for (const id of Object.keys(by)) {
    // ⚠ A RECORD FOR A RUNTIME THIS BUILD DOES NOT REGISTER IS **KEPT VERBATIM AND NEVER READ**.
    // That is the same promise `channel-runtime.js` makes about the pick itself, applied to the
    // settings beside it: a downgrade must not destroy what an upgrade stored. It cannot be
    // validated (there is no descriptor to validate it against) and it cannot be launched (nothing
    // resolves that id), so it is carried and ignored — which is strictly narrower than dropping
    // it, because dropping it makes re-upgrading a silent reset to the narrowest settings.
    if (!ctx.known(id)) {
      if (by[id] && typeof by[id] === 'object' && !Array.isArray(by[id])) out.byRuntime[id] = by[id];
      continue;
    }
    const res = normalizeRuntimeRecord(ctx, id, by[id]);
    if (Object.keys(res.record).length) out.byRuntime[id] = res.record;
    for (const line of res.review) review.push(line);
  }
  return { selection: out, review: review, stored: true };
}

/**
 * A `''` key is "the default runtime" written by a surface that keyed by the unpicked runtime (P3-05).
 * It is folded into the default runtime's record, its fields winning (it is the newer write), so
 * the setting is read instead of being carried as an unregistered id and never read.
 */
function foldDefaultKey(ctx, by) {
  if (!Object.prototype.hasOwnProperty.call(by, '')) return by;
  const out = { ...by };
  const blank = out[''];
  delete out[''];
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  if (obj(blank)) out[ctx.defaultId] = { ...(obj(out[ctx.defaultId]) || {}), ...blank };
  return out;
}

/**
 * MIGRATE the pre-U5 records into a selection. `preset` is the legacy `{tools, messages, model?}`;
 * `runtimeId` is the separately stored pick. ⚠ A legacy `model` is IGNORED since 2026-09-23 —
 * `normalizeRuntimeRecord`'s header says why.
 *
 * ⚠ **INTO THE DEFAULT RUNTIME'S RECORD, WHATEVER RUNTIME IS SELECTED, AND WITHOUT TRANSLATING
 * ANYTHING.** The legacy `tools` is written in the DEFAULT adapter's vocabulary — that is what
 * the old validator accepted and the only thing it could have stored — so that is whose record it
 * belongs in. Putting them under the SELECTED runtime would be this function
 * asserting that `accept_edits` "is" some Codex approval mode, which is exactly the one-to-one
 * mapping the plan refuses: the platforms expose different dimensions and no such equivalence
 * exists.
 *
 * ⚠ SO A CODEX-SELECTED CHANNEL MIGRATES TO "CODEX, WITH NO CODEX SETTINGS YET" — which resolves
 * to Codex's own declared defaults. **That is not a behaviour change**: the legacy `tools` value
 * was already coerced through `capability.js › normalizeToolMode` against the Codex descriptor at
 * every gate decision, and `manual` is not a Codex mode, so it already fail-closed to Codex's
 * narrowest. The migration stores what was always effective.
 *
 * ⚠ AND THE CLAUDE VALUES ARE NOT LOST BY THAT — they are in `byRuntime[default]`, which is what
 * makes switching back restore them (Decision #2).
 */
function fromLegacy(ctx, preset, runtimeId) {
  const out = emptySelection();
  out.runtime = ctx.known(runtimeId) ? runtimeId : '';
  const p = preset && typeof preset === 'object' && !Array.isArray(preset) ? preset : null;
  if (!p) return { selection: out, review: [], stored: false };

  const messages = typeof p.messages === 'string' ? p.messages : '';
  if (SELECTION_MESSAGE_MODES.indexOf(messages) !== -1) out.messages = messages;

  const legacyId = ctx.defaultId;
  const res = normalizeRuntimeRecord(ctx, legacyId, {
    ...(typeof p.tools === 'string' ? { tools: p.tools } : {}),
  });
  if (Object.keys(res.record).length) out.byRuntime[legacyId] = res.record;
  // ⚠ THE MIGRATION ITSELF RAISES NO REVIEW. `res.review` can only fire on a legacy value the
  // DEFAULT adapter no longer offers, which is a real fact an operator can act on, so it is
  // forwarded — but a clean migration is silent, as it must be for the thousands of records that
  // will take this path once and never notice.
  return { selection: out, review: res.review, stored: true };
}

/** The per-runtime record for the SELECTED runtime — never null, possibly empty. */
function activeRecord(ctx, selection) {
  const id = selection.runtime || ctx.defaultId;
  const rec = selection.byRuntime[id];
  return rec && typeof rec === 'object' ? rec : {};
}

/**
 * THE LEGACY WIRE SHAPE, DERIVED FROM A SELECTION — `{ tools, messages }`.
 *
 * ⚠ **IT IS A COMPATIBILITY WINDOW, NOT A SECOND AUTHORITY.** Every renderer older than U5
 * feature-probes these OWN KEYS and renders no row at all when one is missing.
 * ⚠ **`model` LEFT THIS SHAPE ON 2026-09-23, AND ITS ABSENCE IS NOW THE POINT.** The web's own-key
 * probe (`lib/permission-modes.ts › hasModelKey`) reads a missing key as "this desktop has no
 * model setting", so an OLDER renderer meeting this build draws no Model row either — Samuel's
 * ruling reached through the probe, with no flag.
 * ⚠ `tools` COMES BACK IN THE SELECTED RUNTIME'S OWN WORDS, which may not be one of the four
 * legacy members. That is correct and is what the SPA already expects: it coerces the value through
 * `runtime-capability.ts › normalizeToolMode` against the descriptor before rendering, so a Codex
 * channel reads `untrusted` instead of reading `manual` and being coerced to `untrusted`.
 * ⚠ AN EMPTY RECORD ANSWERS THE RUNTIME'S NARROWEST MODE, not the legacy `manual`. Same reason.
 */
function toLegacyPosture(ctx, selection) {
  const rec = activeRecord(ctx, selection);
  return {
    tools: rec.tools || ctx.narrowestToolFor(selection.runtime),
    messages: selection.messages,
  };
}

/**
 * Apply a PATCH to a selection and answer the new one, with any review the patch produced.
 *
 * ⚠ **OWN-KEY THROUGHOUT, AND THE RULE IS THE RUNTIME PICK'S** (`channel-dir-ipc.js ›
 * channels:setLaunchPosture` branches on `hasOwnProperty`). A key the caller did not send is
 * UNCHANGED; a key sent as `''` is a real "clear it". A surface that knows nothing about native
 * settings must be able to write the messaging axis without wiping them, which is the exact
 * failure the model field hit in 2026-09-05.
 *
 * ⚠ **THE PATCH'S FIELDS LAND ON THE RUNTIME THE PATCH SELECTS, NOT ON THE ONE THAT WAS SELECTED
 * BEFORE IT.** A single write that switches runtime AND sets that runtime's sandbox is one
 * operation, and splitting it would write the new setting into the old runtime's record.
 *
 * ⚠ **A RUNTIME SWITCH CHANGES NOTHING ELSE — NO CLEAR, NO TRANSLATION.** Both remembered sets
 * survive (Decision #1).
 * ⚠ A `model` KEY IN A PATCH IS IGNORED (2026-09-23): a renderer one version behind may still send
 * one, and it must neither be stored nor refuse the rest of the write.
 */
/**
 * The HARD failures in a patch — the ones that reject the whole write rather than floor a field.
 * Empty array => the patch may be applied.
 *
 * ⚠ **THE HARD/SOFT SPLIT IS THE PRE-U5 ONE, RE-EXPRESSED IN THE SELECTED RUNTIME'S WORDS.** The
 * old validator rejected the whole write when either AXIS carried an unknown value and let an
 * unknown MODEL through as an absence, for two different reasons that both still hold: a
 * half-applied posture is the "one switch, two meanings" confusion the two axes exist to remove,
 * while refusing a whole posture over a model name would stop a desktop that predates an id from
 * storing anything at all.
 *
 * ⚠ **WHAT CHANGED IS THE LIST THE TOOL AXIS IS CHECKED AGAINST, AND THAT CHANGE IS F-390's FIX.**
 * It was the DEFAULT runtime's four words on every runtime, so the Settings row rendered Codex's
 * vocabulary and main refused the write — the operator moved a control, the hook reverted it, and
 * nothing said why. It is now the SELECTED adapter's own declared options, so the row and the
 * writer finally speak the same language.
 *
 * ⚠ A READ DOES NOT USE THIS. `normalizeSelection` FLOORS an unrecognised stored mode to the
 * adapter's narrowest and says so in its review, because a record already on disk cannot be
 * "rejected" — refusing to read it would strand the channel, and floring it is the fail-closed
 * direction. Writes reject; reads floor. Those are different questions about different data.
 */
function patchRejections(ctx, selection, patch) {
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  const out = [];
  if (has('messages')) {
    const asked = typeof p.messages === 'string' ? p.messages : '';
    if (SELECTION_MESSAGE_MODES.indexOf(asked) === -1) {
      out.push(`"${asked}" is not one of Dopl's messaging settings`);
    }
  }
  if (has('tools')) {
    const asked = typeof p.tools === 'string' ? p.tools.trim() : '';
    // ⚠ THE TARGET IS THE RUNTIME THE PATCH SELECTS, not the one selected before it: a single
    // write that switches runtime AND sets that runtime's tool mode is one operation, and checking
    // the new mode against the old runtime's vocabulary would refuse every such write.
    const targetId = has('runtime') && ctx.known(p.runtime) ? p.runtime : selection.runtime;
    if (!asked || ctx.toolModeFor(targetId, asked) !== asked) {
      out.push(`"${asked}" is not a tool setting ${ctx.labelFor(targetId)} offers`);
    }
  }
  return out;
}

function patchSelection(ctx, selection, patch) {
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  const next = {
    v: SELECTION_VERSION,
    runtime: selection.runtime,
    messages: selection.messages,
    byRuntime: { ...selection.byRuntime },
  };
  const review = [];

  if (has('runtime')) {
    const asked = typeof p.runtime === 'string' ? p.runtime.trim() : '';
    // ⚠ AN UNREGISTERED ID CLEARS RATHER THAN PARKS. The store is not a place to keep a value this
    // build cannot resolve, and the SPA's own list comes from the same registry — so the only way
    // to reach this branch is a hand-edited store or a version-skewed page, and both must land on
    // a runtime this build has already proved.
    next.runtime = ctx.known(asked) ? asked : '';
    if (asked && !next.runtime) {
      review.push(`"${asked}" is not a runtime this version of Dopl can start; the default runtime `
        + 'applies');
    }
  }
  if (has('messages')) {
    const asked = typeof p.messages === 'string' ? p.messages : '';
    if (SELECTION_MESSAGE_MODES.indexOf(asked) === -1) {
      review.push(`"${asked}" is not a messaging setting this build knows; it was not applied`);
    } else {
      next.messages = asked;
    }
  }

  if (has('byRuntime')) {
    // ⚠ **A WHOLE-MAP REPLACE, AND IT HAS EXACTLY ONE PRODUCER: THE NEW-CHANNEL SEED**
    // (`agent-defaults.js › seedChannel`), which copies the profile defaults' every-runtime record
    // into a channel that has none. It is a REPLACE rather than a merge because a seed lands on an
    // empty record by construction — the seed refuses a channel that has any posture at all — so
    // there is nothing to merge with, and a merge here would quietly make "seed" mean "top up".
    // ⚠ EVERY RECORD IS RE-VALIDATED AGAINST ITS OWN ADAPTER on the way in. The defaults record is
    // not a trusted source; it is another stored record, written by the same renderer.
    const res = normalizeSelection(ctx, {
      v: SELECTION_VERSION,
      runtime: next.runtime,
      messages: next.messages,
      byRuntime: p.byRuntime,
    });
    next.byRuntime = res.selection.byRuntime;
    for (const line of res.review) review.push(line);
  }

  const targetId = next.runtime || ctx.defaultId;
  const fields = {};
  for (const key of ['tools', 'native']) if (has(key)) fields[key] = p[key];
  if (Object.keys(fields).length) {
    const prior = next.byRuntime[targetId] && typeof next.byRuntime[targetId] === 'object'
      ? next.byRuntime[targetId]
      : {};
    // ⚠ MERGED ONTO THE PRIOR RECORD, FIELD BY FIELD, so a patch carrying only `native` leaves
    // `tools` where it was. The merge happens BEFORE validation so an unchanged
    // field is re-validated on every write — a value stored by a build that offered it and since
    // withdrawn must not survive untouched just because nobody mentioned it.
    const res = normalizeRuntimeRecord(ctx, targetId, { ...prior, ...fields });
    if (Object.keys(res.record).length) next.byRuntime[targetId] = res.record;
    else delete next.byRuntime[targetId];
    for (const line of res.review) review.push(line);
  }
  return { selection: next, review: review };
}

// ─── END LAUNCH-SELECTION ─────

module.exports = {
  // THE LEGACY READER (one compatibility window) — re-exported from `launch-posture-legacy.js`
  // and again by `channel-prefs.js`, so nothing that used to require these moved.
  TOOL_MODES: legacy.TOOL_MODES,
  MESSAGE_MODES: legacy.MESSAGE_MODES,
  DEFAULT_PRESET: legacy.DEFAULT_PRESET,
  normalizePreset: legacy.normalizePreset,
  defaultPreset: legacy.defaultPreset,
  readPostureFrom: legacy.readPostureFrom,
  effectivePosture: legacy.effectivePosture,
  postureInto: legacy.postureInto,
  // THE VERSIONED, RUNTIME-KEYED SELECTION (2026-09-21, U5).
  SELECTION_VERSION,
  SELECTION_MESSAGE_MODES,
  emptySelection,
  normalizeRuntimeRecord,
  normalizeSelection,
  fromLegacy,
  patchRejections, // U5: the HARD failures — the ones that reject a whole write
  activeRecord,
  toLegacyPosture,
  patchSelection,
};

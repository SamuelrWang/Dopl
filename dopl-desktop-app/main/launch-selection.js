// The durable launch selection's SHAPE: a versioned record with one `{ tools?, native? }` per runtime
// (`byRuntime`), side by side and never translated into one another, so a runtime switch and back
// restores both sets. Pure: callers own storage (`channel-prefs.js`, `agent-defaults.js`), and every
// runtime vocabulary arrives through the injected `ctx` (`runtime/index.js › selectionContext`) —
// no runtime's enums may be spelled here. Every renderer write is re-validated against its adapter.

// ─── BEGIN LAUNCH-SELECTION (pure; unit-tested via source extraction) ────────

// Read before any other field: a version this build does not know resolves restrictive, never as
// if its fields meant what this version means.
const SELECTION_VERSION = 2;

// Dopl's own axis, the same on every runtime.
const SELECTION_MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

/** The selection an unconfigured channel resolves to: the restrictive one. */
function emptySelection() {
  return {
    v: SELECTION_VERSION,
    runtime: '', // '' = the default adapter (`runtime/index.js › resolve`), never "no runtime"
    messages: SELECTION_MESSAGE_MODES[0],
    byRuntime: {},
  };
}

/**
 * One runtime's `{ tools?, native? }`, validated against THAT runtime's descriptor. A stored `model`
 * and any native key the runtime declares a MODEL dimension are dropped silently (no stored model,
 * 2026-09-23). An unrecognised `tools` floors to the runtime's narrowest, never its widest; every
 * field is omitted when absent, never written as `''`/`null`/`{}`.
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

function withoutModelDimensions(ctx, runtimeId, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const modelDims = ctx.modelDimensionsFor(runtimeId);
  const out = {};
  for (const key of Object.keys(raw)) if (modelDims.indexOf(key) === -1) out[key] = raw[key];
  return out;
}

/**
 * Validate a stored value into `{ selection, review, stored }`. Absent → restrictive, no review.
 * Current version → validated per runtime. Future version → restrictive with the runtime pick kept
 * (choosing a runtime widens nothing) and a review. Malformed → restrictive and a review. Never
 * unrestricted: the restrictive answer is `emptySelection()`, not whatever parsed.
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
  // An unregistered pick reads as the default and is not repaired (a downgrade must not erase it).
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
    // An unregistered runtime's record is kept verbatim and never read: a downgrade must not erase
    // what an upgrade stored, and nothing can validate or launch it here.
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

/** A `''` key (a write keyed by the unpicked runtime) folds into the default runtime's record, its fields winning (P3-05). */
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
 * Migrate the pre-U5 records: `preset` is the legacy pair, `runtimeId` the separately stored pick.
 * The legacy `tools` lands in the DEFAULT runtime's record whatever runtime is selected — it is in
 * that runtime's words, and filing it elsewhere would be translating it.
 */
function fromLegacy(ctx, preset, runtimeId) {
  const out = emptySelection();
  out.runtime = ctx.known(runtimeId) ? runtimeId : '';
  const p = legacyPreset(ctx, preset);
  if (!p) return { selection: out, review: [], stored: false };
  out.messages = p.messages;
  out.byRuntime[ctx.defaultId] = { tools: p.tools };
  return { selection: out, review: [], stored: true };
}

/**
 * A whole, valid pre-U5 `{ tools, messages }` pair (tools in the DEFAULT runtime's words), or null.
 * A half-valid pair is no pair, so this and `channel-prefs.js › hasLaunchPosture` agree (P3-34).
 */
function legacyPreset(ctx, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tools = typeof raw.tools === 'string' ? raw.tools : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (!tools || ctx.toolModeFor(ctx.defaultId, tools) !== tools) return null;
  if (SELECTION_MESSAGE_MODES.indexOf(messages) === -1) return null;
  return { tools: tools, messages: messages };
}

/** The per-runtime record for the SELECTED runtime — never null, possibly empty. */
function activeRecord(ctx, selection) {
  const id = selection.runtime || ctx.defaultId;
  const rec = selection.byRuntime[id];
  return rec && typeof rec === 'object' ? rec : {};
}

/**
 * The wire's `{ tools, messages }` own keys: the selected runtime's tool word (its narrowest when
 * unset), never a `model` key.
 */
function toLegacyPosture(ctx, selection) {
  const rec = activeRecord(ctx, selection);
  return {
    tools: rec.tools || ctx.narrowestToolFor(selection.runtime),
    messages: selection.messages,
  };
}

/**
 * The HARD failures in a patch (empty = apply it). Writes reject an unknown `messages` or `tools`;
 * reads floor them (`normalizeSelection`). `tools` is judged against the runtime the patch selects.
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
    const targetId = has('runtime') && ctx.known(p.runtime) ? p.runtime : selection.runtime;
    if (!asked || ctx.toolModeFor(targetId, asked) !== asked) {
      out.push(`"${asked}" is not a tool setting ${ctx.labelFor(targetId)} offers`);
    }
  }
  return out;
}

/**
 * Apply an own-key PATCH (absent key = unchanged; `runtime: ''` = the default) and answer
 * `{ selection, review }`. Fields land on the runtime the SAME patch selects, merged onto its prior
 * record and the whole record re-validated. A runtime switch clears and translates nothing; a
 * `model` key is ignored.
 */
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
    // An unregistered id clears to the default rather than being stored.
    next.runtime = ctx.known(asked) ? asked : '';
    if (asked && !next.runtime) {
      review.push(`"${asked}" is not a runtime this version of Dopl can start; the default runtime `
        + 'applies');
    }
  }
  if (has('messages') && SELECTION_MESSAGE_MODES.indexOf(p.messages) !== -1) next.messages = p.messages;

  if (has('byRuntime')) {
    // A whole-map REPLACE with one producer, `agent-defaults.js › seedChannel`, which only writes a
    // channel with no posture; each record is re-validated against its own adapter.
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
    const res = normalizeRuntimeRecord(ctx, targetId, { ...prior, ...fields });
    if (Object.keys(res.record).length) next.byRuntime[targetId] = res.record;
    else delete next.byRuntime[targetId];
    for (const line of res.review) review.push(line);
  }
  return { selection: next, review: review };
}

// ─── END LAUNCH-SELECTION ─────

module.exports = {
  SELECTION_VERSION,
  SELECTION_MESSAGE_MODES,
  emptySelection,
  normalizeSelection,
  fromLegacy,
  legacyPreset,
  patchRejections,
  activeRecord,
  toLegacyPosture,
  patchSelection,
};

// The durable launch selection's SHAPE: one permission LEVEL (Ask / Auto / Full, the operator's one
// control) that each runtime applies in its own native settings (`runtime/permission-level.js`),
// plus the runtime pick and Dopl's message axis. `byRuntime` holds a per-runtime level only where
// a migrated record had an explicit, different choice for that runtime; setting the level clears
// it. Pure: callers own storage (`channel-prefs.js`, `agent-defaults.js`), and every runtime
// vocabulary arrives through the injected `ctx` (`runtime/index.js › selectionContext`).

// ─── BEGIN LAUNCH-SELECTION (pure; unit-tested via source extraction) ────────

// Read before any other field: a version this build does not know resolves restrictive.
const SELECTION_VERSION = 3;
// v2 stored `{ tools, native }` per runtime; it migrates on read (`fromV2`) and on the next write.
const V2 = 2;

// Dopl's own axis, the same on every runtime.
const SELECTION_MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The selection an unconfigured channel resolves to: the restrictive one. */
function emptySelection(ctx) {
  return {
    v: SELECTION_VERSION,
    runtime: '', // '' = the default adapter (`runtime/index.js › resolve`), never "no runtime"
    messages: SELECTION_MESSAGE_MODES[0],
    level: ctx.levels[0],
    byRuntime: {},
  };
}

/** The runtime id a lookup lands on: a known id, else the selected one, else the default. */
const runtimeOf = (ctx, sel, runtimeId) => (ctx.known(runtimeId) ? runtimeId : (sel.runtime || ctx.defaultId));

/** The level `runtimeId` launches at: its migrated override, else the channel's level. */
function levelFor(ctx, sel, runtimeId) {
  return sel.byRuntime[runtimeOf(ctx, sel, runtimeId)] || sel.level;
}

/** `{ tools, native, label }` — the level in that runtime's own words. */
function settingsFor(ctx, sel, runtimeId) {
  return ctx.levelSettings(runtimeOf(ctx, sel, runtimeId), levelFor(ctx, sel, runtimeId));
}

/** The wire's `{ tools, messages }` own keys for the SELECTED runtime. */
function toLegacyPosture(ctx, sel) {
  return { tools: settingsFor(ctx, sel, '').tools, messages: sel.messages };
}

// Shared by every version: the runtime pick and the message axis.
function baseOf(ctx, raw, review) {
  const out = emptySelection(ctx);
  // An unregistered pick reads as the default and is not repaired (a downgrade must not erase it).
  out.runtime = ctx.known(raw.runtime) ? raw.runtime : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (SELECTION_MESSAGE_MODES.indexOf(messages) !== -1) out.messages = messages;
  else if (messages) review.push(`"${messages}" is not a messaging setting this build knows; messaging fell back to "${out.messages}"`);
  return out;
}

/**
 * Validate a stored value into `{ selection, review, stored }`. Absent → restrictive, no review.
 * v3 → validated; v2 → migrated (`fromV2`); future or malformed → restrictive with a review.
 * Never unrestricted: every unreadable field resolves to Ask.
 */
function normalizeSelection(ctx, raw) {
  if (raw == null) return { selection: emptySelection(ctx), review: [], stored: false };
  if (!isObj(raw)) {
    return { selection: emptySelection(ctx), review: ['the stored launch settings could not be read, so the most restrictive ones apply'], stored: false };
  }
  const version = Number(raw.v);
  if (version === V2) return fromV2(ctx, raw);
  if (version !== SELECTION_VERSION) {
    const restrictive = emptySelection(ctx);
    const newer = version > SELECTION_VERSION;
    // Choosing a runtime widens nothing, so a newer record's pick is kept.
    if (newer && ctx.known(raw.runtime)) restrictive.runtime = raw.runtime;
    return {
      selection: restrictive,
      review: [newer
        ? `these launch settings were written by a newer version of Dopl (record v${version}); this build reads v${SELECTION_VERSION}, so the most restrictive settings apply until they are set again here`
        : 'the stored launch settings are not in a shape this build recognises, so the most restrictive ones apply'],
      stored: false,
    };
  }
  const review = [];
  const out = baseOf(ctx, raw, review);
  out.level = levelOrReview(ctx, raw.level, 'the channel', review);
  const by = isObj(raw.byRuntime) ? raw.byRuntime : {};
  for (const id of Object.keys(by)) {
    // An unregistered runtime's entry is kept verbatim and never read (a downgrade must not erase it).
    if (!ctx.known(id)) { out.byRuntime[id] = by[id]; continue; }
    const level = levelOrReview(ctx, by[id], ctx.labelFor(id), review);
    if (level !== out.level) out.byRuntime[id] = level;
  }
  return { selection: out, review: review, stored: true };
}

function levelOrReview(ctx, raw, who, review) {
  if (ctx.levels.indexOf(raw) !== -1) return raw;
  if (raw != null && raw !== '') review.push(`"${raw}" is not a permission level; ${who} fell back to "${ctx.levels[0]}"`);
  return ctx.levels[0];
}

/**
 * The level a v2 per-runtime `{ tools, native }` record meant, or '' with no explicit tools. A
 * record that meant more than its level applies is reviewed (it narrowed, never widened).
 */
function levelOfRecord(ctx, id, rec, review) {
  if (!isObj(rec) || typeof rec.tools !== 'string' || !rec.tools) return '';
  const level = ctx.levelOf(id, rec.tools, rec.native);
  const was = ctx.settingText(id, rec.tools, rec.native);
  const now = ctx.levelSettings(id, level);
  const nowText = ctx.settingText(id, now.tools, now.native);
  if (was !== nowText) review.push(`${ctx.labelFor(id)}'s stored setting "${was}" is now ${level} (${nowText})`);
  return level;
}

/**
 * Migrate a v2 record. The channel's level is what the operator chose for the selected runtime
 * (else the default runtime, where a pre-U5 pair landed); a runtime with no explicit record
 * inherits it, and an explicit, different record keeps its own level for that runtime.
 */
function fromV2(ctx, raw) {
  const review = [];
  const out = baseOf(ctx, raw, review);
  const by = foldDefaultKey(ctx, isObj(raw.byRuntime) ? raw.byRuntime : {});
  const levels = {};
  for (const id of Object.keys(by)) {
    if (!ctx.known(id)) continue;
    const level = levelOfRecord(ctx, id, by[id], review);
    if (level) levels[id] = level;
  }
  out.level = levels[out.runtime || ctx.defaultId] || levels[ctx.defaultId] || ctx.levels[0];
  for (const id of Object.keys(levels)) if (levels[id] !== out.level) out.byRuntime[id] = levels[id];
  return { selection: out, review: review, stored: true };
}

/** A v2 `''` key (a write keyed by the unpicked runtime) folds into the default runtime's record, its fields winning (P3-05). */
function foldDefaultKey(ctx, by) {
  if (!has(by, '')) return by;
  const out = { ...by };
  const blank = out[''];
  delete out[''];
  if (isObj(blank)) out[ctx.defaultId] = { ...(isObj(out[ctx.defaultId]) ? out[ctx.defaultId] : {}), ...blank };
  return out;
}

/** Migrate the pre-U5 pair (`preset`, tools in the DEFAULT runtime's words) + separate pick. */
function fromLegacy(ctx, preset, runtimeId) {
  const out = emptySelection(ctx);
  out.runtime = ctx.known(runtimeId) ? runtimeId : '';
  const p = legacyPreset(ctx, preset);
  if (!p) return { selection: out, review: [], stored: false };
  out.messages = p.messages;
  out.level = ctx.levelOf(ctx.defaultId, p.tools);
  return { selection: out, review: [], stored: true };
}

/**
 * A whole, valid pre-U5 `{ tools, messages }` pair (tools in the DEFAULT runtime's words), or null.
 * A half-valid pair is no pair, so this and `channel-prefs.js › hasLaunchPosture` agree (P3-34).
 */
function legacyPreset(ctx, raw) {
  if (!isObj(raw)) return null;
  const tools = typeof raw.tools === 'string' ? raw.tools : '';
  const messages = typeof raw.messages === 'string' ? raw.messages : '';
  if (!tools || ctx.toolModeFor(ctx.defaultId, tools) !== tools) return null;
  if (SELECTION_MESSAGE_MODES.indexOf(messages) === -1) return null;
  return { tools: tools, messages: messages };
}

/** The HARD failures in a patch (empty = apply it). Reads floor what writes reject. */
function patchRejections(ctx, _sel, patch) {
  const p = isObj(patch) ? patch : {};
  const out = [];
  if (has(p, 'messages') && SELECTION_MESSAGE_MODES.indexOf(p.messages) === -1) {
    out.push(`"${p.messages}" is not one of Dopl's messaging settings`);
  }
  if (has(p, 'level') && ctx.levels.indexOf(p.level) === -1) {
    out.push(`"${p.level}" is not a permission level (${ctx.levels.join(', ')})`);
  }
  // The per-runtime words are derived from the level now; a write naming them is from an older UI.
  for (const key of ['tools', 'native']) {
    if (has(p, key)) out.push(`"${key}" is no longer stored; choose a permission level (${ctx.levels.join(', ')})`);
  }
  return out;
}

/**
 * Apply an own-key PATCH (absent key = unchanged; `runtime: ''` = the default) → `{ selection,
 * review }`. `level` sets the one control for every runtime, so it clears the migrated overrides;
 * `byRuntime` is a whole-map replace with one producer (`agent-defaults.js › seedChannel`).
 */
function patchSelection(ctx, sel, patch) {
  const p = isObj(patch) ? patch : {};
  const next = { ...sel, v: SELECTION_VERSION, byRuntime: { ...sel.byRuntime } };
  const review = [];
  if (has(p, 'runtime')) {
    const asked = typeof p.runtime === 'string' ? p.runtime.trim() : '';
    next.runtime = ctx.known(asked) ? asked : '';
    if (asked && !next.runtime) review.push(`"${asked}" is not a runtime this version of Dopl can start; the default runtime applies`);
  }
  if (has(p, 'messages') && SELECTION_MESSAGE_MODES.indexOf(p.messages) !== -1) next.messages = p.messages;
  if (has(p, 'level') && ctx.levels.indexOf(p.level) !== -1) {
    next.level = p.level;
    next.byRuntime = {};
  }
  if (has(p, 'byRuntime')) {
    const res = normalizeSelection(ctx, { ...next, byRuntime: p.byRuntime });
    next.byRuntime = res.selection.byRuntime;
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
  levelFor,
  settingsFor,
  toLegacyPosture,
  patchSelection,
};

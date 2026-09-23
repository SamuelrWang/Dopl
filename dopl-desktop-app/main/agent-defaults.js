// DEFAULT agent settings (a launch selection + the chaining flag) a new channel is SEEDED with once.
// Local only. Never read at a spawn or as `getLaunchPosture`'s fallback: an ambient posture at a
// spawn nobody attends is what H2 forbids, and it would re-point every existing channel.

const Store = require('electron-store');
const selection = require('./launch-selection');
const runtimeRegistry = require('./runtime');
const channelPrefs = require('./channel-prefs');
const { diag } = require('./diag');

const store = new Store();

const ctx = () => runtimeRegistry.selectionContext();

// ─── BEGIN AGENT-DEFAULTS-VALIDATE (pure; unit-tested via source extraction) ──

/**
 * A defaults record — a launch selection plus `agentChain` — or null. Messaging is HARD (unknown =
 * null); the per-runtime half floors to that runtime's narrowest; `agentChain` is `=== true` only.
 * A record with no `v` is pre-U5 and migrates through `sel.fromLegacy`.
 */
function normalizeDefaults(sel, ctx, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const legacy = raw.v == null;
  const res = legacy
    ? sel.fromLegacy(ctx, { tools: raw.tools, messages: raw.messages }, raw.runtime)
    : sel.normalizeSelection(ctx, raw);
  // Asked of the INPUT: `normalizeSelection` would floor an unknown messaging value, not reject it.
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

/** The renderer's view (stored, or the restrictive factory answer); `tools`/`runtime` are always own keys. */
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

/** A write's hard failures: a registered runtime's `tools` it does not offer (reads floor it; P3-29). */
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

/** The effective defaults, never null (an unset machine answers the restrictive record). */
function getAgentDefaults() {
  return effectiveDefaults(selection, ctx(), readStored());
}

/**
 * Persist the defaults (a rejected write mutates nothing). The WHOLE record is rewritten: its one
 * writer, the Agents tab, always sends all of it; a second writer would need the own-key idiom.
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
 * Seed a newly created channel from the defaults — `{ ok, seeded }`. Called by the renderer that
 * created it (`channels:applyAgentDefaults`) and by `channel-seed-watch.js` (agent-created rooms).
 * WRITE-ONCE: a channel with any posture (`hasLaunchPosture`) is skipped whole, chaining flag
 * included; that guard, not the callers, is what keeps existing channels untouched.
 */
function seedChannel(channelId) {
  if (!channelId) return { ok: false, seeded: false };
  if (channelPrefs.hasLaunchPosture(channelId)) return { ok: true, seeded: false };
  const stored = readStored();
  // No defaults record seeds nothing: stamping the factory answer would be a posture nobody chose.
  if (!stored) return { ok: true, seeded: false };
  // Every runtime's record is copied, through the one validating writer (it re-validates them all).
  const res = channelPrefs.setLaunchSelection(channelId, {
    runtime: stored.runtime,
    messages: stored.messages,
    byRuntime: stored.byRuntime,
  });
  if (!res || res.ok !== true) return { ok: false, seeded: false };
  // Only after a successful selection write: a rejected write must never half-apply a bound.
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

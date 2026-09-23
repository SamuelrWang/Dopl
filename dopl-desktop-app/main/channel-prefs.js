// Per-channel launch selection (+ re-exported chaining, consent and identity-approval records).
// Local electron-store only, never sent to Dopl; the IPC surface is channel-dir-ipc.js.

const Store = require('electron-store');
const selection = require('./launch-selection');
const runtimeRegistry = require('./runtime');
const { diag } = require('./diag');

const store = new Store();

const ctx = () => runtimeRegistry.selectionContext();

const agentChain = require('./channel-agent-chain');
const orchestratorConsent = require('./orchestrator-consent');
const identityApproval = require('./identity-approval');

// `channelLaunchSelection` is the only record a read trusts. The two pre-U5 keys are a read-only
// migration source (`launch-selection.js › fromLegacy`); nothing writes them.
const POSTURE_KEY = 'channelLaunchPosture'; // legacy: { [channelId]: { tools, messages } }
const SELECTION_KEY = 'channelLaunchSelection'; // { [channelId]: { v, runtime, messages, byRuntime } }
const RUNTIME_KEY = 'channelRuntime'; // legacy: { [channelId]: '<runtime id>' }

function readMap(key) {
  try {
    const map = store.get(key);
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch (_err) {
    return {}; // an unreadable store is the RESTRICTIVE selection, never a grant
  }
}

/** `{ selection, review, stored }`, never null. A legacy record migrates on the read; the read never persists it. */
function getLaunchSelectionDetail(channelId) {
  if (!channelId) return { selection: selection.emptySelection(), review: [], stored: false };
  const c = ctx();
  const raw = readMap(SELECTION_KEY)[channelId];
  if (raw != null) return selection.normalizeSelection(c, raw);
  return selection.fromLegacy(c, readMap(POSTURE_KEY)[channelId], readMap(RUNTIME_KEY)[channelId]);
}

const getLaunchSelection = (channelId) => getLaunchSelectionDetail(channelId).selection;

/** The selected runtime's `{ tools, messages }`, or its restrictive default. Never null. */
function getLaunchPosture(channelId) {
  return selection.toLegacyPosture(ctx(), getLaunchSelection(channelId));
}

/**
 * Has this channel been configured at all? Presence only, over BOTH the new and the legacy key.
 * `session-private.js › channelMessageMode` reads false as "no opinion" (an unset channel must not
 * narrow running sessions), and `agent-defaults.js › seedChannel`'s write-once guard depends on it.
 */
function hasLaunchPosture(channelId) {
  if (!channelId) return false;
  if (readMap(SELECTION_KEY)[channelId] != null) return true;
  return selection.legacyPreset(ctx(), readMap(POSTURE_KEY)[channelId]) !== null;
}

/**
 * Persist an own-key PATCH (an absent key is left alone), re-validated here against its adapter —
 * the renderer is untrusted. A hard failure writes nothing: `{ ok: false, rejected }`.
 */
function setLaunchSelection(channelId, patch) {
  if (!channelId) return { ok: false };
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const c = ctx();
  const current = getLaunchSelection(channelId);
  const rejected = selection.patchRejections(c, current, p);
  if (rejected.length) {
    diag('channel-prefs: refused a launch-selection write —', rejected.join('; '));
    return { ok: false, rejected: rejected };
  }
  const res = selection.patchSelection(c, current, p);
  const preset = selection.toLegacyPosture(c, res.selection);
  try {
    const map = readMap(SELECTION_KEY);
    map[channelId] = res.selection;
    store.set(SELECTION_KEY, map);
  } catch (err) {
    diag('channel-prefs: could not persist the launch selection —', err && err.message);
    return { ok: false };
  }
  diag('channel-prefs selection', String(channelId).slice(0, 8),
    res.selection.runtime || '(default)', preset.tools, preset.messages);
  return { ok: true, preset: preset, selection: res.selection, review: res.review };
}

/**
 * `{ tools, messages }` for ONE runtime (`''`/unregistered = the selected one), messages unfloored:
 * the ceiling a directive or per-agent pick is clamped to, and the live Axis-A value it gates on.
 */
function launchPostureFor(channelId, runtimeId) {
  const r = runtimeRecord(channelId, runtimeId);
  return { tools: r.tools, messages: r.sel.messages };
}

function runtimeRecord(channelId, runtimeId) {
  const c = ctx();
  const sel = getLaunchSelection(channelId);
  const rt = c.known(runtimeId) ? runtimeId : (sel.runtime || c.defaultId);
  const rec = selection.activeRecord(c, { ...sel, runtime: rt });
  return { sel: sel, rec: rec, tools: rec.tools || c.narrowestToolFor(rt) };
}

/**
 * `spec.startModes` for a launch on `runtimeId` (C1), messages windowless-floored. The only spawn
 * read of the stored posture (H2; button + operator-armed directive lanes); gates read it live via
 * `session-private.js`. The native bag is opaque to core: only the adapter's launch spec reads it.
 */
function launchStartModes(channelId, runtimeId) {
  const r = runtimeRecord(channelId, runtimeId);
  return {
    tools: r.tools,
    messages: require('./session-profiles').floorWindowlessMessage(r.sel.messages),
    native: r.rec.native ? { ...r.rec.native } : {},
  };
}

module.exports = {
  getAgentChain: agentChain.getAgentChain,
  setAgentChain: agentChain.setAgentChain,
  getOrchestratorLaunch: orchestratorConsent.getOrchestratorLaunch,
  setOrchestratorLaunch: orchestratorConsent.setOrchestratorLaunch,
  getOrchestratorDirect: orchestratorConsent.getOrchestratorDirect,
  setOrchestratorDirect: orchestratorConsent.setOrchestratorDirect,
  isIdentityApproved: identityApproval.isIdentityApproved,
  approveIdentity: identityApproval.approveIdentity,
  getLaunchSelection,
  getLaunchSelectionDetail,
  setLaunchSelection,
  getLaunchPosture,
  hasLaunchPosture,
  launchStartModes,
  launchPostureFor,
};

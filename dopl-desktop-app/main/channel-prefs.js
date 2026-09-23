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
//   AXIS A  tools    = each runtime's own words, stored per runtime (`byRuntime[id].tools`)
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
// `session-ipc-ops.js › sessions:launch`, the operator's own Launch button on their own thread —
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
// ⚠ **THE RECORD'S SHAPE AND ITS VALIDATION MOVED TO `main/launch-selection.js` ON 2026-09-21
// (U5)**, at the §1 cap and on a real seam: that file changes when the SHAPE of a stored launch
// selection changes — its version, what migrates into it, what an unreadable version falls back to
// — where this one changes when a CHANNEL PREFERENCE moves. The whole `CHANNEL-PREFS-VALIDATE`
// fence went with it and is re-exported below, so no caller and no suite moved; the block is
// sliced from its new home by `test/_channel-prefs-block.mjs`.
const selection = require('./launch-selection');
// ⚠ THE REGISTRY, FOR THE ADAPTER VOCABULARY A SELECTION IS VALIDATED AGAINST. It is
// electron-free at load by contract (`main/runtime/contract.js`), so requiring it costs this one
// nothing — and it is what replaced `require('./session-model')` here. **That import was the bug
// U5 exists to remove**: it validated EVERY runtime's model against the DEFAULT runtime's frozen
// id list, so a Codex pick could not be stored at all.
const runtimeRegistry = require('./runtime');
const { diag } = require('./diag');

const store = new Store();

const ctx = () => runtimeRegistry.selectionContext();


// ── AUTO-SEND (2026-08-20, when the session window was deleted) — a DURABLE per-channel
// setting: it narrows nothing (it governs whether the operator's OWN agent's reply posts
// without a Send click), it is chosen on the channel's Settings tab, and it must survive
// restarts or the operator would re-opt-in per session.
// Default OFF — ask-first: an absent, corrupt, or non-boolean record reads false.
//
// ⚠ READ **LIVE AT THE GATE** SINCE 2026-08-31 (Samuel's ruling): `session-private.js ›
// effectiveMessageMode` consults `getAutoSend(channelId)` on every Axis-B decision, so the
// toggle applies to EVERY session in the channel IMMEDIATELY — running ones, reopened shells,
// crash resumes, private and directed turns included — ON and OFF alike. It is deliberately
// NOT folded into any launch-time mode any more (see `windowlessMessageMode`): one live
// reader, zero frozen copies.
// ── ⚠ AUTO-SEND IS DELETED (2026-09-06, Samuel's settings overhaul, item 8) ──────────────────
//
// It was a SECOND control over the SAME axis as the launch posture's `messages`, and the two
// disagreed by construction: `messages` was frozen into a session at launch, this was read live
// at the gate, and `session-private.js › autoSendMessageMode` FORCED the out half on over
// whatever `messages` said. An operator could set Messaging to `ask` and still have agents
// posting unattended, with nothing on the tab saying which one was in force.
//
// ⚠ WHAT SURVIVED IS THE READ SITE, NOT THE RECORD, AND THAT IS THE WHOLE POINT. The 2026-08-31
// ruling's content was *"if a user toggles auto-send, that goes into effect for ALL their agents
// in that channel, IMMEDIATELY"* — a property of WHERE it was read, not of what it was stored in.
// `effectiveMessageMode` still reads live at every Axis-B decision; it reads `getLaunchPosture`'s
// `messages` now. So a Messaging change still applies to running sessions, reopened shells, crash
// resumes and directed turns at once, exactly as the toggle did.
//
// ⚠ THE STORED KEY IS DELIBERATELY NOT MIGRATED, AND NOT READ ONE LAST TIME. `channelAutoSend`
// rows left on disk are inert: a machine that had the toggle ON now follows whatever that
// channel's Messaging value says, which is the value its operator can SEE. Reading the old key to
// "preserve" the setting would be the opposite of this item — it would restore, invisibly, the
// second authority the fold exists to remove. The key is not re-registered anywhere; a future
// store cleanup may drop it.
//
// ⚠ IF SOMETHING STILL NEEDS THIS: it wants `getLaunchPosture(channelId).messages`. There is no
// separate send flag any more, on purpose.

// ⚠ **AGENT CHAINING MOVED TO `main/channel-agent-chain.js` ON 2026-09-21 (U5)**, at the §1 cap
// and on the same seam the two MCP consents and the identity approval moved on: it changes when
// the rules for how far a chain of launches may reach change, where the rest of this file changes
// when the shape of a channel's launch settings does — and it is the only record in this family
// that lifts a BOUND rather than storing a posture or a pick. Its header carries the whole safety
// argument (what it does NOT lift, and what stands in for a generation count when it is on).
// Re-exported below, so no caller moved.
const agentChain = require('./channel-agent-chain');

// ⚠ **THE TWO MCP CONSENTS MOVED TO `main/orchestrator-consent.js` ON 2026-08-31**, at the
// §1 cap and on a real seam: they change when a capability an EXTERNAL agent may ask for is
// added or its grant moves, where the rest of this file changes when a CHANNEL preference
// does. Re-exported below, so no caller moved.
const orchestratorConsent = require('./orchestrator-consent');


// ⚠ **THE FIRST-USE IDENTITY APPROVAL MOVED TO `main/identity-approval.js` ON 2026-08-31**, at
// the §1 cap and on the same seam the two MCP consents moved on one wave earlier: it changes when
// the rules for trusting ANOTHER MEMBER'S standing configuration change, where the rest of this
// file changes when a CHANNEL preference does — and its record is keyed by an IDENTITY ID, not by
// a channel at all. Re-exported below, so no caller moved.
const identityApproval = require('./identity-approval');

// ── Storage for the durable selection ─────────────────────────────────────
//
// ⚠ **THREE KEYS, ONE AUTHORITY, AND TWO DOWNGRADE MIRRORS (2026-09-21, U5).**
// `channelLaunchSelection` is the VERSIONED, RUNTIME-KEYED record and it is the only thing a read
// trusts. `channelLaunchPosture` — the pre-U5 `{tools, messages, model}` pair — and
// `channelRuntime` — the old separately stored runtime pick — survive for exactly two jobs:
//
//   MIGRATION  a channel with no selection record reads its legacy pair (and `channel-runtime.js`'s
//              separately stored pick) through `launch-selection.js › fromLegacy`. **Reading
//              never writes**, so a machine that only ever launches keeps both records untouched
//              and can be downgraded with nothing lost.
//   DOWNGRADE  every selection WRITE re-derives the legacy pair for the SELECTED runtime and
//              stores both it and that runtime pick. An older build therefore gets the runtime
//              and settings actually in force, instead of two records left on different clocks.
//
// ⚠ THE MIRROR IS NEVER READ WHILE A SELECTION RECORD PARSES. If it were, the two could disagree
// and nothing would say which won — which is the failure the auto-send/`messages` overlap already
// cost this tree once (2026-09-06, item 8).
const POSTURE_KEY = 'channelLaunchPosture'; // LEGACY MIRROR: { [channelId]: { tools, messages } } (a stored `model` is ignored)
const SELECTION_KEY = 'channelLaunchSelection'; // { [channelId]: { v, runtime, messages, byRuntime } }
const RUNTIME_KEY = 'channelRuntime'; // LEGACY MIRROR: { [channelId]: '<runtime id>' }

function readMap(key) {
  try {
    const map = store.get(key);
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch (_err) {
    return {}; // an unreadable store is the RESTRICTIVE selection, never a grant
  }
}

/**
 * THE CHANNEL'S DURABLE LAUNCH SELECTION — `{ selection, review, stored }`, never null.
 *
 * ⚠ MIGRATION HAPPENS ON THE READ AND IS NOT PERSISTED BY IT. A read that wrote would turn every
 * launch, every Settings mount and every posture probe into a store write, and would mean a
 * DOWNGRADE lost the operator's pre-U5 settings the first time the new build looked at them.
 * ⚠ `review` IS THE `needs review` STATE THE PLAN ASKS FOR. It is never empty on a record this
 * build could not fully honour, and the settings it describes are always the narrower ones — there
 * is no path here that answers a WIDER setting than what was stored.
 */
function getLaunchSelectionDetail(channelId) {
  if (!channelId) return { selection: selection.emptySelection(), review: [], stored: false };
  const c = ctx();
  const raw = readMap(SELECTION_KEY)[channelId];
  if (raw != null) return selection.normalizeSelection(c, raw);
  // ⚠ LAZY, AND ONLY HERE. `channel-runtime.js` reads its pick THROUGH this function now, so a
  // top-level require there plus one here would cycle; the legacy key is read directly instead,
  // which is also the only place in this tree that still touches it for a decision.
  return selection.fromLegacy(c, readMap(POSTURE_KEY)[channelId], readMap(RUNTIME_KEY)[channelId]);
}

/** The selection alone, for the callers that cannot act on a review. */
const getLaunchSelection = (channelId) => getLaunchSelectionDetail(channelId).selection;

/**
 * THE EFFECTIVE launch posture for this channel, in the LEGACY WIRE SHAPE — the selected runtime's
 * pair, or the restrictive default. ⚠ NEVER null: a durable setting that is absent IS the
 * narrowest pair, and saying so is the truth. Reading never writes.
 * ⚠ AND IT CARRIES NO `model` SINCE 2026-09-23 — `launch-selection.js › toLegacyPosture` says why
 * the key's absence is the point.
 */
function getLaunchPosture(channelId) {
  return selection.toLegacyPosture(ctx(), getLaunchSelection(channelId));
}

/**
 * ⚠ **HAS THIS CHANNEL BEEN CONFIGURED AT ALL?** (2026-09-07) — presence, never a posture.
 *
 * `getLaunchPosture` cannot answer this and must not learn to: it answers the restrictive
 * DEFAULT for a channel nobody has set, which is the truth the Settings tab needs. But a LIVE
 * reader needs the other fact. `session-private.js › channelMessageMode` is the live Axis-B read
 * and its whole contract is that `''` means NO OPINION — an unconfigured channel included — so
 * the caller falls back to the session's own frozen launch posture. Without this distinction the
 * default `ask` reads as a channel-wide PICK and silently narrows every running session on every
 * channel the operator has never opened Settings for, which is most of them.
 *
 * ⚠ IT DISCLOSES NO POSTURE, only whether one was written, so it is not a second reader of the
 * permission pair in the sense the H2 census is about (`channel-runtime.test.mjs`): nothing can
 * widen a launch with a boolean.
 * ⚠ **IT ASKS BOTH RECORDS, AND THAT IS WHAT KEEPS THE WRITE-ONCE SEED HONEST ACROSS THE
 * MIGRATION** (`agent-defaults.js › seedChannel` refuses when this answers true). A channel
 * configured before U5 has only the legacy pair; reading the new key alone would call it
 * unconfigured and let the profile defaults overwrite settings its operator chose.
 */
function hasLaunchPosture(channelId) {
  if (!channelId) return false;
  if (readMap(SELECTION_KEY)[channelId] != null) return true;
  return selection.legacyPreset(ctx(), readMap(POSTURE_KEY)[channelId]) !== null;
}

/**
 * Persist a PATCH to the channel's launch selection. `{ ok, preset, selection, review }`.
 *
 * ⚠ **OWN-KEY, LIKE THE RUNTIME PICK IT NOW CARRIES.** A key the caller did not send is left
 * alone; `''` is a real "clear it". The pre-U5 writer rewrote the whole pair on every change,
 * which is how a Permissions pick from a surface with no model concept dropped the operator's
 * stored model (2026-09-05).
 * ⚠ **`{ ok: false }` AND NO MUTATION WHEN THE LEGACY PAIR IS HALF-VALID.** A caller sending
 * `tools`/`messages` in the pre-U5 way still gets the whole-pair-or-nothing rule, because a
 * partially applied posture is the "one switch, two meanings" confusion the two axes exist to
 * remove. A caller sending only runtime/native is not making that claim and is not held to it.
 * ⚠ **EVERY VALUE IS RE-VALIDATED HERE, IN MAIN, AGAINST THE SELECTED ADAPTER.** The app window
 * hosts remote content, so a renderer one version ahead is a hostile input: an unregistered
 * runtime, a mode outside the adapter's declared options and a native key the adapter cannot
 * spend are each refused or floored on THIS side of the bridge (a `model` key is ignored).
 */
function setLaunchSelection(channelId, patch) {
  if (!channelId) return { ok: false };
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const c = ctx();
  const current = getLaunchSelection(channelId);
  // ⚠ FAIL-CLOSED BEFORE ANYTHING IS WRITTEN. A rejected write mutates nothing, so it can never
  // leave a half-applied record behind — and the SPA's hook reverts its optimistic pick on
  // `{ok:false}`, which only works if the refusal precedes the store.
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
 * The channel's posture for ONE runtime — `{ tools, messages }`, messages UNFLOORED. The ceiling a
 * directive or a per-agent pick is clamped to, and the live Axis-A value a running session of that
 * runtime reads. `runtimeId` `''`/unregistered = the channel's selected runtime, else the default.
 * ⚠ Never null: an unconfigured channel is that runtime's narrowest word and `ask`.
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
 * The `spec.startModes` for a launch on `runtimeId` (C1) — that runtime's own tool word and native
 * bag, and the shared windowless message derivation above. `runtimeId` resolves as in
 * `launchPostureFor`, so a dialog pick of Codex in a Claude room starts on the CODEX record (X-02).
 */
function launchStartModes(channelId, runtimeId) {
  const r = runtimeRecord(channelId, runtimeId);
  return {
    tools: r.tools,
    messages: require('./session-profiles').floorWindowlessMessage(r.sel.messages),
    // ⚠ **THE NATIVE SETTINGS, AND THIS IS THE ONE PLACE THEY BECOME A SPAWN** (U5). Codex's
    // `sandbox_mode` had a READER (`runtime/codex/launch-spec.js › nativePair`) and **no producer
    // anywhere in the tree** — F-390's shape exactly, a control that writes nowhere. ⚠ CONTAINMENT
    // ONLY since 2026-09-23: the model-scoped reasoning effort is no longer stored
    // (`launch-selection.js › normalizeRuntimeRecord`). They travel as `spec.startModes`, handed in per launch by a caller executing a
    // decision a human is making right now, which is the SAME rule and the same single consumer
    // the permission pair has (H2). A shape that passes nothing inherits the runtime's own
    // declared defaults, exactly as it does for the pair.
    // ⚠ CORE NEVER LOOKS INSIDE THIS BAG. It is `{ <declared key>: <declared value> }` validated
    // by the selected adapter and stamped verbatim; the adapter's launch spec is its only reader.
    native: r.rec.native ? { ...r.rec.native } : {},
  };
}

// ── ⚠ `getLaunchModel` / `getLaunchModelLink` ARE DELETED (2026-09-23, Samuel: *"We don't need a
// pin model in the settings"*) ─────────────────────────────────────────────────────────────────
//
// They were the CHANNEL link of every launch lane's model chain. A launch's model is now the
// launcher's explicit pick, else the identity's, else the RUNTIME's own default
// (`runtime/launch-default.js`, applied once in `session-launch.js › launch`), so there is no
// channel link to read — and no "the channel's stored model is no longer offered" refusal either.

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

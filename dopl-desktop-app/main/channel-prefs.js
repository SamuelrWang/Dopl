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
// file changes when a CHANNEL preference does — and its record is keyed by a IDENTITY ID, not by
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
const POSTURE_KEY = 'channelLaunchPosture'; // LEGACY MIRROR: { [channelId]: { tools, messages, model? } }
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

function getAllPostures() {
  return readMap(POSTURE_KEY);
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
  return selection.fromLegacy(c, getAllPostures()[channelId], readMap(RUNTIME_KEY)[channelId]);
}

/** The selection alone, for the callers that cannot act on a review. */
const getLaunchSelection = (channelId) => getLaunchSelectionDetail(channelId).selection;

/**
 * THE EFFECTIVE launch posture for this channel, in the LEGACY WIRE SHAPE — the selected runtime's
 * pair, or the restrictive default. ⚠ NEVER null: a durable setting that is absent IS the
 * narrowest pair, and saying so is the truth. Reading never writes.
 * ⚠ AND IT ALWAYS CARRIES `model` — `null` when none is stored. See
 * `launch-selection.js › toLegacyPosture` for why the WIRE shape and the STORED shape differ.
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
 * permission pair in the sense the H2 census is about (`channel-runtime.test.mjs`,
 * `agent-model-selection.test.mjs`): nothing can widen a launch with a boolean.
 * ⚠ **IT ASKS BOTH RECORDS, AND THAT IS WHAT KEEPS THE WRITE-ONCE SEED HONEST ACROSS THE
 * MIGRATION** (`agent-defaults.js › seedChannel` refuses when this answers true). A channel
 * configured before U5 has only the legacy pair; reading the new key alone would call it
 * unconfigured and let the profile defaults overwrite settings its operator chose.
 */
function hasLaunchPosture(channelId) {
  if (!channelId) return false;
  if (readMap(SELECTION_KEY)[channelId] != null) return true;
  return selection.readPostureFrom(getAllPostures(), channelId) !== null;
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
 * remove. A caller sending only runtime/model/native is not making that claim and is not held to
 * it.
 * ⚠ **EVERY VALUE IS RE-VALIDATED HERE, IN MAIN, AGAINST THE SELECTED ADAPTER.** The app window
 * hosts remote content, so a renderer one version ahead is a hostile input: an unregistered
 * runtime, a mode outside the adapter's declared options, a model outside its roster/alphabet and
 * a native key the adapter cannot spend are each refused or floored on THIS side of the bridge.
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
    // THE DOWNGRADE MIRROR — see the block above. Best-effort: a mirror that fails costs an older
    // build a stale read, never this build a lost setting, so it does not fail the write.
    const legacy = getAllPostures();
    legacy[channelId] = preset.model
      ? { tools: preset.tools, messages: preset.messages, model: preset.model }
      : { tools: preset.tools, messages: preset.messages };
    store.set(POSTURE_KEY, legacy);
    // The runtime was a separate pre-U5 record, so it needs its own downgrade mirror beside the
    // posture mirror above. Use the NORMALIZED selection value rather than the patch: an unknown
    // renderer-supplied id resolves to the default runtime, and an omitted runtime keeps the
    // current effective pick. `''` deletes the legacy member, preserving the old record's one
    // spelling of "default" and leaving every neighbouring channel untouched.
    const runtimes = { ...readMap(RUNTIME_KEY) };
    if (res.selection.runtime) runtimes[channelId] = res.selection.runtime;
    else delete runtimes[channelId];
    store.set(RUNTIME_KEY, runtimes);
  } catch (err) {
    diag('channel-prefs: could not persist the launch selection —', err && err.message);
    return { ok: false };
  }
  diag('channel-prefs selection', String(channelId).slice(0, 8),
    res.selection.runtime || '(default)', preset.tools, preset.messages);
  return { ok: true, preset: preset, selection: res.selection, review: res.review };
}

/**
 * Persist the channel's launch posture — the LEGACY WRITE NAME, kept because it is what
 * `channel-dir-ipc.js › channels:setLaunchPosture` and `agent-defaults.js › seedChannel` call.
 * ⚠ SPENT BY NOTHING. There is no consume twin on purpose — that is what makes this the durable
 * half of the split described above.
 */
function setLaunchPosture(channelId, raw) {
  // ⚠ THE LEGACY WRITE REQUIRED BOTH AXES AND THIS KEEPS THAT, because its callers send both and
  // a pre-U5 renderer sending one of them means something it cannot mean here. `setLaunchSelection`
  // itself is own-key — that is what lets a native-settings write leave the pair alone.
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const hasTools = Object.prototype.hasOwnProperty.call(p, 'tools');
  const hasMessages = Object.prototype.hasOwnProperty.call(p, 'messages');
  if (hasTools !== hasMessages) return { ok: false };
  return setLaunchSelection(channelId, p);
}

/**
 * THE WINDOWLESS MESSAGE AXIS — ONE derivation, both windowless lanes.
 *
 * A windowless session has NO Accept UI, so the IN half is floored at
 * `auto_inbound` on every shape (INVARIANTS §11: the consent that admitted the
 * thread is the human decision, and a counterparty reply feeds as a turn). The
 * OUT half is a picked posture that already says "send out".
 *
 * ⚠ **AUTO-SEND IS NO LONGER FOLDED IN HERE (2026-08-31, Samuel's ruling).** The toggle is read
 * LIVE at decision time — `session-private.js › effectiveMessageMode`, the single Axis-B read —
 * and it must have exactly ONE consumer: the frozen copy this function used to bake into
 * `state.messageMode` at launch is precisely why flipping the switch did nothing for sessions
 * already running, and why a reopened/recreated/resumed shell (which drops its startModes — H2)
 * silently lost it while the control still said ON. A setting with a live reader and a frozen
 * copy is two settings that disagree; the frozen copy is the one that goes.
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
  const autoOut = picked === 'auto_outbound' || picked === 'auto_both';
  return autoOut ? 'auto_both' : 'auto_inbound';
}

/**
 * The `spec.startModes` for the OPERATOR'S OWN windowless launch (the Agents
 * tab's button) — the durable posture's tool axis, and the shared message
 * derivation above. The one place the durable posture becomes a spawn.
 */
function launchStartModes(channelId) {
  const c = ctx();
  const sel = getLaunchSelection(channelId);
  const rec = selection.activeRecord(c, sel);
  return {
    // ⚠ IN THE SELECTED RUNTIME'S OWN WORDS SINCE 2026-09-21 (U5), where this used to hand over
    // the DEFAULT runtime's vocabulary on every runtime. Nothing observable changed for a launch:
    // the gate already coerced the value through `capability.js › normalizeToolMode` against the
    // session's own descriptor, so `manual` on a Codex channel already fail-closed to Codex's
    // narrowest. What changed is that the operator can now STORE the Codex word.
    tools: rec.tools || c.narrowestToolFor(sel.runtime),
    messages: windowlessMessageMode(channelId, sel.messages),
    // ⚠ **THE NATIVE SETTINGS, AND THIS IS THE ONE PLACE THEY BECOME A SPAWN** (U5). Codex's
    // `sandbox_mode` and reasoning effort had a READER (`runtime/codex/launch-spec.js › nativePair`)
    // and **no producer anywhere in the tree** — F-390's shape exactly, a control that writes
    // nowhere. They travel as `spec.startModes`, handed in per launch by a caller executing a
    // decision a human is making right now, which is the SAME rule and the same single consumer
    // the permission pair has (H2). A shape that passes nothing inherits the runtime's own
    // declared defaults, exactly as it does for the pair.
    // ⚠ CORE NEVER LOOKS INSIDE THIS BAG. It is `{ <declared key>: <declared value> }` validated
    // by the selected adapter and stamped verbatim; the adapter's launch spec is its only reader.
    native: rec.native ? { ...rec.native } : {},
  };
}

/**
 * THE CHANNEL'S CHOSEN MODEL FOR THE RUNTIME IT WILL LAUNCH ON, or '' for the platform default.
 *
 * ⚠ IT IS A SEPARATE READER FROM `getLaunchPosture` ON PURPOSE, AND THE REASON IS H2. That
 * function has exactly ONE consumer — `session-ipc-ops.js › sessions:launch`, the operator's own
 * click — and `test/session-preset-start.test.mjs` pins the count, because a second reader of the
 * stored PERMISSION pair re-opens the failure H2 exists to prevent (a posture reaching a spawn
 * nobody is attending). The MODEL is not that: it grants nothing, widens nothing, and reaches no
 * gate, so the PEER-TRIGGERED lane (`trigger.js`) may inherit it and must not be able to inherit
 * the pair alongside it. Two readers, so the census stays honest about which one is which.
 *
 * ⚠ **RUNTIME-SCOPED SINCE 2026-09-21 (U5).** It used to read ONE global field, which is why
 * `channel-runtime.js` had to CLEAR it on every runtime switch: a Claude id left behind on a Codex
 * channel sat ABOVE the platform default in the launch precedence chain, so the stale id WON and
 * Codex was asked for a model it has never heard of. With one record per runtime there is no stale
 * id to win — and switching back restores the pick instead of finding it deleted.
 */
function getLaunchModel(channelId) {
  const c = ctx();
  return selection.activeRecord(c, getLaunchSelection(channelId)).model || '';
}

/**
 * THE CHANNEL'S MODEL AS THE LAST LINK OF A LAUNCH'S MODEL PRECEDENCE CHAIN — the value a spawn is
 * stamped with when no sheet pick and no identity default outranked it.
 *
 * ⚠ **IT EXISTS BECAUSE THE CALL SITES USED TO ALIAS THE STORED ID THROUGH THE DEFAULT RUNTIME'S
 * TABLE** (`sessionModel.aliasForModelId(channelPrefs.getLaunchModel(id))`). That was correct while
 * only one roster could ever be stored; now that a Codex id can be, aliasing it answers the default
 * runtime's "no pick" member and the operator's choice is silently dropped. Resolving it HERE,
 * against the channel's own runtime, is what keeps one rule in one place across the three launch
 * lanes — `session-launch-op.js › launchFromButton`, `trigger.js › launchResponderSession` and the
 * orchestrator directive lane.
 *
 * ⚠ **IT ENDS THE CHAIN RATHER THAN STEPPING ASIDE, AND THAT IS THE EXPRESSION IT REPLACED, VERB
 * FOR VERB.** `chainModel`'s `''` means "keep going" (F-285) and belongs to the links ABOVE this
 * one — an identity naming a model this build does not know must fall THROUGH to the channel. This
 * is the bottom link: when nothing is stored it answers the runtime's own "no pick" member
 * (`descriptor.models.defaultMeansAbsent`), which is what every spawn got before a picker existed.
 */
function getLaunchModelLink(channelId) {
  const sel = getLaunchSelection(channelId);
  const picked = selection.activeRecord(ctx(), sel).model || '';
  return runtimeRegistry.capability.launchModelPick(
    runtimeRegistry.descriptorFor(sel.runtime), picked
  );
}

module.exports = {
  // ⚠ `getAutoSend` / `setAutoSend` REMOVED 2026-09-06 (item 8) — see the block above. The one
  // live reader was `session-private.js › effectiveMessageMode`, which reads `getLaunchPosture`
  // now; the IPC ops and the web hook went in the same change.
  // 2026-08-31 (Samuel's ruling): the per-channel AGENT-CHAINING setting — the one-generation
  // launch bound, made toggleable. Default OFF = today's bound. The block above states what it
  // lifts, what it does not, and what stands in for a generation count when it is on.
  AGENT_CHAIN_KEY: agentChain.AGENT_CHAIN_KEY,
  getAgentChain: agentChain.getAgentChain,
  setAgentChain: agentChain.setAgentChain,
  // THE MACHINE-WIDE STANDING CONSENTS for the two MCP-driven capabilities — launching an
  // agent (2026-08-22) and DIRECTING one (2026-08-31). ⚠ RE-EXPORTED from
  // `orchestrator-consent.js` (§1 split), which carries why "outside the server entirely" is
  // the security content rather than the storage, and why there is one toggle per capability.
  ORCHESTRATOR_LAUNCH_KEY: orchestratorConsent.ORCHESTRATOR_LAUNCH_KEY,
  getOrchestratorLaunch: orchestratorConsent.getOrchestratorLaunch,
  setOrchestratorLaunch: orchestratorConsent.setOrchestratorLaunch,
  ORCHESTRATOR_DIRECT_KEY: orchestratorConsent.ORCHESTRATOR_DIRECT_KEY,
  getOrchestratorDirect: orchestratorConsent.getOrchestratorDirect,
  setOrchestratorDirect: orchestratorConsent.setOrchestratorDirect,
  // 2026-08-22 (OQ-3): FIRST-USE APPROVAL for another member's agent identity. Same
  // machine-local, never-server-reachable property as the toggle above, and the block over these
  // two functions says why that property is the security content.
  IDENTITY_APPROVAL_KEY: identityApproval.IDENTITY_APPROVAL_KEY,
  isIdentityApproved: identityApproval.isIdentityApproved,
  approveIdentity: identityApproval.approveIdentity,
  // The DURABLE launch selection. ⚠ THE SHAPE AND ITS VALIDATION LIVE IN
  // `main/launch-selection.js` (§1 split, 2026-09-21 — U5); the five names below are re-exported
  // from there so no caller and no suite moved, and they are the LEGACY READER for one
  // compatibility window, not the write path.
  readPostureFrom: selection.readPostureFrom,
  effectivePosture: selection.effectivePosture, // the pre-U5 WIRE shape
  postureInto: selection.postureInto,
  TOOL_MODES: selection.TOOL_MODES,
  MESSAGE_MODES: selection.MESSAGE_MODES,
  DEFAULT_PRESET: selection.DEFAULT_PRESET,
  normalizePreset: selection.normalizePreset,
  defaultPreset: selection.defaultPreset,
  POSTURE_KEY, // the legacy mirror's key — see the storage block
  SELECTION_KEY, // U5: the versioned, runtime-keyed record — the one a read trusts
  getLaunchSelection,
  getLaunchSelectionDetail, // U5: the selection PLUS its `needs review` sentences
  setLaunchSelection,
  getLaunchPosture,
  hasLaunchPosture, // 2026-09-07: presence only — see the block above and `session-private.js`
  setLaunchPosture,
  windowlessMessageMode,
  launchStartModes,
  getLaunchModel, // 2026-08-22: the model half, readable WITHOUT the permission pair
  getLaunchModelLink, // U5: the same pick, resolved as a launch-chain link on its OWN runtime
};

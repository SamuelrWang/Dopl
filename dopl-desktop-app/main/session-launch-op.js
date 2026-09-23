// THE NEW AGENT BUTTON, END TO END — the body of `sessions:launch`, and its approval twin.
//
// ⚠ SPLIT OUT OF `main/session-ipc-ops.js` ON 2026-08-22, under the hard 500-line §1 cap. That
// file sat at 499: it could absorb ONE line, and the agent-identity wiring needs a resolve, a
// refusal table, an approval gate and a model precedence chain. INVARIANTS §1's rule for a file
// in that state is explicit — it has stopped being CORRECTABLE, so the answer is a split.
//
// THE SEAM IS REASON-TO-CHANGE, and it is a real one. `session-ipc-ops.js` owns the IPC SURFACE:
// which verbs exist, who may call them, how a bad payload is refused. This file owns WHAT ONE
// LAUNCH IS — the goal text, the identity it wears, the posture it inherits, the model it runs
// on. Those move on different clocks, and everything else in `session-ipc-ops.js` is a read, a
// stop verb or a window while this one CREATES something.
//
// ⚠ THE SENDER BINDING DID NOT MOVE AND MUST NOT. `appWindowOnly('sessions:launch', …)` is still
// written LITERALLY at the `ipcMain.handle` site, because `test/channel-ipc-sender.test.mjs`'s
// structural belt reads exactly that shape and a guard hidden inside a factory passes review
// while silently disarming the next op somebody adds. This module is called FROM inside that
// wrapper; it is not a second door.
//
// ⚠ AND THE PAYLOAD IS STILL UNTRUSTED HERE. Every id is re-validated in this file, because the
// split moved the code, not the boundary.

const { isUuid } = require('./ipc-guards');
const { isAgentId } = require('./agent-id');
const { diag } = require('./diag');

// NEW AGENT ON A THREAD (2026-08-20; SPAWN-IDLE and multi-agent since 2026-08-21). A WINDOWLESS
// requester-side session: the clicking human IS the consent (it is their own agent on their own
// thread — no row is raised), the message axis is floored at auto_inbound, and the OUT half is
// the channel's auto-send posture. UUID-gated channel; a supplied taskId must be a UUID too
// (first-class threads only — a legacy exchange has no thread to attach to).
//
// ⚠ TWO THINGS CHANGED ON 2026-08-21 (Samuel's rulings 2 and 3) AND BOTH ARE CONTRACT:
//
//   1. IT MINTS AN AGENT ID AND RETURNS IT — `{ ok: true, agentId }`. The id is the ADDRESS of
//      the thing just created: it names the pill, it is what a human @-mentions in the thread to
//      talk to THIS agent rather than its siblings, and it is the third argument every other
//      session op takes. `sessionId` still rides along and is still an opaque React key.
//   2. IT STARTS NOTHING. The session is registered IDLE with prepared context (channel, thread,
//      workspace, operator, posture) and NO first SDK turn: `query()` does not run until the
//      first inbound message for this agent arrives, at which point it launches with the full
//      framing plus that message. So the button is cheap, pressing it twice genuinely gives you
//      two agents, and an agent nobody talks to costs no `claude` child.
//
// ⚠ `counterpartyId` IS OPTIONAL and no longer refuses the launch. It used to be REQUIRED
// because it FENCED THE FEED; the fan-out ruling replaced that fence with the thread
// (`main/session-dispatch.js`). It still rides through when known: it labels the outbound card.
//
// ⚠ `taskId` IS NULLABLE SINCE 2026-08-21 (Samuel's CHANNEL-LEVEL AGENT ruling) — `null` spawns
// an agent attached to the CHANNEL rather than to a thread, keyed `<channelId>::<agentId>`. What
// differs is only its FEED SCOPE, which falls out of the fan-out for free.
// ⚠ `null` AND `''` ARE DIFFERENT REQUESTS THAT LAND ON THE SAME SCOPE, and both are accepted
// rather than one being normalised away: `null` is the SPA asking for a channel-level agent, `''`
// is the legacy wire value for a responder whose exchange never became a first-class thread.
//
// ⚠ THERE IS NO `no-counterparty` REFUSAL ANY MORE, on this lane or any other.

/**
 * **ONE OF THE SIXTEEN AGENT COLOUR KEYS, OR `null`** (2026-09-13;
 * docs/specs/agent-colors.md).
 *
 * ⚠ **A LOCAL COPY OF THE PATTERN, AND THE DUPLICATION IS FORCED RATHER THAN CHOSEN.** `main/`
 * cannot import from `src/` (two trees, two builds), so the set is spelled here as it is
 * spelled in `src/features/channels/lib/agent-colors.ts › AGENT_COLOR_KEYS`, in
 * `@dopl/contracts › AgentColorKey`, in `packages/mcp-server/src/tools/channel-ops-launch-color.ts`
 * and in both column CHECKs in `20261005120000_agent_session_colors.sql`. ⚠ ANCHORED AT BOTH
 * ENDS: an unanchored test would accept `agent-03 please`, and the value ends up substituted
 * into a CSS custom property name on the far side.
 *
 * ⚠ **`null` FOR ANYTHING UNRECOGNIZED, WHICH IS "LET THE SERVER PICK" AND NEVER A REFUSAL.**
 * A launch is not worth failing over a decoration — the whole lane treats an unknown colour the
 * way F-5 treats an unknown model, and an agent with no colour runs perfectly well wearing the
 * neutral box.
 */
const AGENT_COLOR_RE = /^agent-(0[1-9]|1[0-6])$/;
function colorKey(value) {
  return typeof value === 'string' && AGENT_COLOR_RE.test(value) ? value : null;
}

/**
 * ⚠ DID THE CALLER ASK FOR AN IDENTITY AT ALL? Absent, `null` and `''` all mean NO, and a launch
 * that asks for none is BYTE-IDENTICAL to what this lane did before identities existed — no
 * resolve, no round trip, no `context.identity`, and `identityRoleFraming` returns `[]`.
 *
 * ⚠ A PRESENT-BUT-MALFORMED ID IS A REFUSAL, NOT A BLANK LAUNCH. The obvious reading of "validate
 * `isUuid(p.identityId) ? p.identityId : null`" quietly turns a garbled id into a blank agent,
 * and F-1's whole argument is that a blank agent silently wearing NO IDENTITY is worse than
 * nothing: the operator picked an identity and will not notice its absence for several turns.
 * `identity-resolve.js › resolveAgentIdentity` answers `no-identity` for a non-UUID, so the refusal
 * falls out of asking it rather than being a second rule here.
 */
function wantsIdentity(value) {
  return value != null && value !== '';
}

async function launchFromButton(payload) {
  const p = payload || {};
  if (!isUuid(p.channelId)) return { ok: false };
  const channelLevel = p.taskId == null || p.taskId === '';
  if (!channelLevel && !isUuid(p.taskId)) return { ok: false };
  const engine = require('./session-engine');
  const channelPrefs = require('./channel-prefs');
  const targeting = require('./targeting');
  const listener = require('./channel-listener');
  // ⚠ CONTAINMENT: the profile comes from MAIN's own watched-channel record — the FULL server
  // DTO off the loop entry (`channel-listener.js › watchedChannel`), never the renderer's claim
  // and ⚠ never the tray's id+name PROJECTION, which is what this read until F-267 (no profile
  // field on it, so EVERY launch here floored). Unwatched, or a DTO missing it: fails closed.
  // ⚠ AN IDENTITY NEVER TOUCHES THIS LINE. An identity widens PROMPT CONTENT ONLY: it never
  // supplies, influences or relaxes a containment input — the tool profile, the permission axes,
  // the working folder and the delivery lane stay the machine's, resolved from the machine's own
  // state. That sentence is INVARIANTS §5A's and it is enforced by this ordering: the profile is
  // computed before the identity is even fetched, from a source the payload cannot reach.
  // ⚠ …AND NARROWED FOR A SHARED ROOM ON THE WAY OUT (2026-09-02, ruling B7). The button lane
  // has a human at the keyboard, which is an argument for keeping an explicit `full` — but it is
  // an argument nobody has made, and the ruling is about the ROOM, not about who pressed. This
  // lane and the other two resolve through one function so they cannot answer differently for one
  // channel again (F-510, and F-267 before it).
  const toolProfile = targeting.resolveLaunchToolProfile(listener.watchedChannel(p.channelId));
  const workspaceId = typeof p.workspaceId === 'string' ? p.workspaceId : null;

  // ── ⚠ THE LAUNCH SHEET'S EPHEMERAL OVERRIDES, NARROWED FIRST ──────────────────────────────
  //
  // The sheet may re-point THIS SPAWN's model and its custom-field VALUES. Nothing here is
  // written back to the identity. It is narrowed BEFORE the resolve because the model half
  // applies to a BLANK launch too — the sheet opens on `Blank agent` as well as on an identity —
  // and because `identity-resolve.js › narrowOverrides` is where the charset rule the RENDERER
  // cannot reach is enforced (F-281: `@/shared/lib/safe-label` imports zod, so no SPA surface can
  // hold `SAFE_LABEL_RE`, and MAIN is the only real validator of this payload).
  // ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE", so an untouched sheet and a plain row click
  // produce byte-identical launches.
  const overrides = require('./identity-resolve').narrowOverrides(p.overrides);

  // ── THE IDENTITY, RESOLVED BY MAIN, AT SPAWN ──────────────────────────────────────────────
  let identity = null;
  if (wantsIdentity(p.identityId)) {
    const res = await require('./identity-resolve').resolveAgentIdentity(p.identityId, workspaceId);
    // F-1 / F-2 / F-3 / F-4: REFUSE. Never degrade to a blank agent.
    if (!res.ok) return { ok: false, reason: res.reason };
    identity = res.identity;
    // ── ⚠ FIRST-USE APPROVAL FOR A FOREIGN IDENTITY (OQ-3) ────────────────────────────────
    //
    // Another member's instructions are about to become standing configuration for an
    // autonomous agent running on THIS machine under THIS operator's credential. One approval,
    // the first time, per identity, machine-local (`channel-prefs.js › isIdentityApproved` —
    // read its block for why the store may never be server-reachable).
    //
    // ⚠ IT IS A REFUSAL ROUND TRIP, NOT A MODAL RAISED FROM MAIN. The launch came from a button
    // in the SPA's own window, so the SPA is where the operator already is; main raising its own
    // dialog would put a second, differently-styled approval surface in front of them and would
    // block the IPC reply while it sat there. The renderer shows the sheet, calls
    // `sessions.approveIdentity(identityId)`, and relaunches.
    // ⚠ THE INSTRUCTIONS RIDE BACK so the sheet shows THE TEXT MAIN RESOLVED, verbatim. An
    // approval over a body the renderer fetched separately is an approval over a different
    // document than the one that will run.
    // ⚠ OWN IDENTITIES SKIP THIS ENTIRELY. `authoredByCaller === true` is never asked about — an
    // approval prompt over your own configuration is the noise that teaches people to click
    // through the ones that matter.
    if (!identity.authoredByCaller && !channelPrefs.isIdentityApproved(p.identityId)) {
      diag('sessions:launch: foreign identity awaiting first-use approval', String(p.identityId).slice(0, 8));
      return {
        ok: false,
        reason: 'identity-approval',
        identity: { name: identity.name, instructions: identity.instructions },
      };
    }
    // ⚠ THE FIELD OVERRIDES ARE APPLIED AFTER THE APPROVAL GATE, DELIBERATELY. What the operator
    // is asked to approve is the identity's INSTRUCTIONS — the part they did not write — and
    // those are never overridable at launch. Applying the sheet's values first would change
    // nothing about the approval and would put renderer text in front of the question.
    identity = require('./identity-resolve').applyOverrides(identity, overrides);
  }
  // A BLANK launch with typed instructions still runs as an instructions-only role (F-695).
  if (!identity) identity = require('./identity-resolve').applyOverrides(null, overrides);

  const title = typeof p.threadTitle === 'string' ? p.threadTitle.slice(0, 200) : '';
  // ⚠ THE GOAL IS DISPLAY/SEED TEXT ONLY ON THIS LANE and is never sent as a turn — a SPAWN-IDLE
  // session has no first turn at all. It survives because `startSession` builds the initiating-
  // request payload from it, and because a CHANNEL-LEVEL agent has no thread to be told to read.
  // ⚠ AN IDENTITY DOES NOT REPLACE IT, AND IT DOES NOT SUPPRESS THE IDENTITY. ROLE FIRST, GOAL
  // LAST: the role is WHO YOU ARE and the goal is WHAT TO DO NOW, and the goal reads last,
  // adjacent to FIRST ACTIONS and DELIVERY, which is what the agent acts on.
  const goal = channelLevel
    ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
    : title
      ? `Join the thread "${title}" as my agent: read it with dopl_channel (op "read", thread=<id>) and carry the work forward.`
      : 'Join this thread as my agent: read it with dopl_channel (op "read", thread=<id>) and carry the work forward.';

  // ⚠ THE RUNTIME IS RESOLVED BEFORE THE MODEL, BECAUSE THE IDENTITY LINK IS ASKED OF IT
  // (2026-09-23): an identity's model counts only if THIS runtime offers it
  // (`runtime/launch-default.js › identityModelFor`). The sheet's own pick is not filtered here —
  // it is the launcher's explicit choice, and the funnel refuses it with a sentence if unknown.
  // Runtime order (Samuel's ruling 5): the sheet's pick -> the identity's runtime -> the channel's
  // -> the default. A pick or identity runtime this Mac cannot run is refused (`no-sdk`), never
  // swapped for another vendor (`launch-default.js › resolveLaunchRuntime`).
  const launchDefault = require('./runtime/launch-default');
  const resolved = await launchDefault.resolveLaunchRuntime({ pick: p.runtime, identity, channelId: p.channelId });
  if (!resolved.ok) {
    diag('sessions:launch: runtime', resolved.runtimeId, 'is not usable here — refusing (no-sdk)');
    return { ok: false, reason: resolved.reason };
  }
  const runtimeId = resolved.runtimeId;
  const model = overrides.model || await launchDefault.identityModelFor(runtimeId, identity && identity.model);

  const res = await engine.launchRequesterSession({
    channelId: p.channelId,
    // '' is the CHANNEL-LEVEL scope, not a missing value — see the block above.
    taskId: channelLevel ? '' : p.taskId,
    workspaceId,
    // ── ⚠ THE CALLER'S PRE-ASSIGNED INSTANCE ID (2026-08-27, Samuel's launch-panel ruling) ──
    //
    // The composer's launch panel shows the operator the agent's ID *before* it exists, so the
    // id has to be minted before the spawn — `sessions:mintAgentId` hands one out and the panel
    // sends it back here. **This field was the ONE gap in that chain:** `session-launch.js ›
    // launch` has always honoured `a.agentId` (a resume re-uses its own) and the preload
    // forwards this payload RAW, but THIS function rebuilds the args field by field, so a
    // caller-supplied id was dropped here and main minted a different one — the panel would
    // have shown an address the agent never had.
    //
    // ⚠ IT IS NOT TRUSTED, IT IS ACCEPTED. `isAgentId` (`main/agent-id.js`, anchored and
    // exact-length) is the same acceptance test every renderer-supplied id on this bridge gets;
    // anything else falls through to a fresh mint rather than refusing, which is the same
    // fail-toward-working direction `launch` itself takes. A renderer cannot invent a SHAPE, and
    // an id grants nothing — it addresses.
    //
    // ⚠ AN ID THAT COLLIDES WITH A LIVE SLOT IS ALREADY HANDLED AND NOT BY THIS LINE:
    // `launch`'s post-await `hasLiveSession(slot)` answers `skipped: 'busy'`, which the SPA
    // already renders. Nothing new is reachable here — the panel mints from the same CSPRNG
    // main does, into the same ~2.0e12 space, against at most MAX_CONCURRENT_SESSIONS live
    // slots.
    agentId: isAgentId(p.agentId) ? p.agentId : undefined,
    goal,
    counterpartyId: isUuid(p.counterpartyId) ? p.counterpartyId : null,
    direct: p.direct === true,
    context: {
      channelName: typeof p.channelName === 'string' ? p.channelName.slice(0, 120) : '',
      taskTitle: channelLevel ? null : (title || null),
      channelId: p.channelId,
      workspaceId,
      taskId: channelLevel ? '' : p.taskId,
      // ⚠ THE SCOPE THE FRAMING READS (2026-08-21). `prompt-framing.js` cannot infer
      // "channel-level" from an absent thread id alone — a legacy responder also has none — so
      // the launch that KNOWS states it.
      scope: channelLevel ? 'channel' : 'thread',
      workspaceSegment: typeof p.workspaceSegment === 'string' ? p.workspaceSegment : null,
      // ── ⚠ THE RESOLVED IDENTITY, CAPTURED AT SPAWN AND NEVER RE-READ ────────────────────
      //
      // `session-launch.js › launch` forwards `context` on a LITERAL WHITELIST and
      // `session-engine.js › startSession` merges `spec.context` onto the session, so this costs
      // ZERO funnel changes and works identically on both launch lanes.
      //
      // ⚠ THE CONSEQUENCE IS THE RIGHT ONE AND IT IS NOT ENFORCED, IT FALLS OUT: A SESSION KEEPS
      // ITS SPAWN-TIME IDENTITY CONTENT. The resolve happens once, here; the role block is built
      // at WAKE from what was captured now (`session-seed.js › takeFraming`, a one-shot). A
      // identity edited between spawn and wake does not change the session, and an identity
      // DELETED after spawn does not stop it — the content is on the session object, not a
      // pointer to a row. `null` when no identity was asked for, so the framing emits nothing.
      identity,
    },
    toolProfile,
    mode: 'interactive',
    windowless: true,
    // THE DURABLE POSTURE, CONSUMED HERE AND NOWHERE ELSE (2026-08-20) — this is the ONLY call
    // site, which is what keeps H2 intact: the click on Launch is the human decision this posture
    // applies to. A peer wake, a resume and a recreate still pass nothing and start narrowest.
    // ⚠ THE LAUNCH RUNTIME'S RECORD (C1), not the channel's selected one: a dialog pick of another
    // runtime starts on THAT runtime's stored words and native bag (X-02 / P3-04).
    // ⚠ MESSAGES WIDENS, NEVER NARROWS, and it is floored at auto_inbound for the windowless
    // reason (no Accept UI exists).
    startModes: channelPrefs.launchStartModes(p.channelId, runtimeId),
    // THE RUNTIME, resolved above. ⚠ THE RENDERER'S VALUE IS ACCEPTED, NOT TRUSTED: an id this
    // build does not register is refused before this point, and a registered adapter is one
    // `contract.js › sealAdapter` has already proved can enforce every Dopl profile it declares.
    // That is why a runtime may come off the payload where the TOOL PROFILE, three fields down, may
    // never: picking a runtime widens nothing (`main/channel-runtime.js`'s header), and picking a
    // profile is containment itself.
    runtime: runtimeId,
    // ── ⚠ THE MODEL PRECEDENCE CHAIN, COMPUTED IN MAIN AND ONLY IN MAIN ───────────────────
    //
    //   sessions:setModel live override (post-spawn, `session-reopen.js`)
    //     > overrides.model              (the LAUNCH SHEET's deliberate per-call pick)
    //     > identity.model               (the identity's DEFAULT)
    //     > the RUNTIME's default        (`runtime/launch-default.js`, applied in the funnel)
    //
    // 🔓 **THE CHANNEL LINK IS DELETED (2026-09-23, Samuel: *"We don't need a pin model in the
    // settings"*).** `channelPrefs.getLaunchModel(Link)` sat between the identity and the runtime
    // default; there is no stored channel or profile model any more.
    //
    // ⚠ THE SHEET BEATS THE IDENTITY for the same reason the orchestrator's explicit `model`
    // param beats it on the directive lane: one is a DELIBERATE PER-CALL CHOICE and the other is
    // a DEFAULT. It also applies to a BLANK launch, where there is no identity to outrank — the
    // sheet opens on `Blank agent` too, and dropping the pick there would be a control that
    // silently does nothing.
    //
    // ⚠ EACH LINK IS CONSULTED IN TURN AND THE FIRST ONE THAT NAMES A MODEL WINS.
    // ⚠ **F-5 IS REVERSED (2026-09-22).** A link naming a model used to fall through when THIS
    // BUILD'S FROZEN TABLE did not know it ("unknown model falls back, never refuses") — which is
    // also how a model the CLI started offering after this build shipped could never be launched,
    // and how a mistyped one silently became the next link's. The table is not the authority any
    // more; the runtime's LIVE roster is. So the SHEET's pick is spent as named, and one this
    // machine's runtime does not offer is REFUSED by the funnel with the list it does offer
    // (`session-launch.js › refuseUnknownModel`, `no-model`).
    // ⚠ **THE IDENTITY'S MODEL IS NOT REFUSED — IT IS SKIPPED WHEN THE RUNTIME DOES NOT OFFER IT
    // (2026-09-23).** It is a default, and a Claude-authored identity launched on Codex asked for
    // nothing on Codex; `identityModelFor` (computed above, beside the runtime) answers `''` and
    // the runtime default applies.
    // ⚠ A legacy alias (`opus`) or an old full id still resolves: the roster carries them as
    // aliases of the row that is that model today (`runtime/claude/roster.js`).
    // ⚠ `''` HERE IS "NO PICK", and the funnel turns it into the runtime's default.
    model,
    // ⚠ **THE AGENT COLOUR THE OPERATOR PICKED IN THE NEW-AGENT POPUP** (Samuel, 2026-09-13;
    // docs/specs/agent-colors.md). ⚠ IT SITS BESIDE `model` BECAUSE IT IS THE SAME KIND OF
    // FIELD, and that block's argument transfers line for line: forwarded, never invented,
    // normalized here rather than trusted downstream, GRANTS NOTHING and reaches NO GATE — so
    // it may travel further than the permission pair and needs none of `getLaunchPosture`'s
    // ceremony.
    // ⚠ **AND THERE IS NO PRECEDENCE CHAIN, WHICH IS THE DIFFERENCE FROM `model` ABOVE.** A
    // identity does not carry a colour and a channel has no stored default, because a colour is
    // UNIQUE among a channel's live agents across every member — a remembered pick would be a
    // pick that collides the second time it is used. So there is exactly one producer (the
    // popup) and exactly one fallback: omit it, and the server assigns the FIRST FREE key
    // (`src/features/channels/lib/agent-colors.ts › firstFreeAgentColor`).
    // ⚠ **NORMALIZED HERE BECAUSE MAIN IS THE ONLY REAL VALIDATOR OF THIS PAYLOAD** — the same
    // F-281 reason `narrowOverrides` is called above: the renderer cannot hold the charset rule,
    // so a value off the IPC boundary is narrowed before it is forwarded, and anything that is
    // not one of the sixteen keys becomes `null` ("let the server pick") rather than travelling
    // as junk that a `var(--agent-color-…)` would later resolve to nothing.
    color: colorKey(p.color),
    // ⚠ SPAWN IDLE (ruling 3): register, prepare the context, send NO first turn.
    idle: true,
    // ⚠ DEPTH 0 — "A HUMAN STARTED THIS", AND THIS IS THE ONLY LANE THAT MAY SAY SO (2026-08-25,
    // F-320). It is the same fact `operatorArmed` below rides on, kept as its own field because it
    // answers a different question: that one is "may this spawn take the posture the operator
    // configured", this one is "may the agent this spawn creates ask for agents of its own".
    // ⚠ THE DIRECTIVE LANE MUST NEVER COPY THIS LINE — it sets `operatorArmed` too (the toggle is
    // its human), and a directive-spawned agent claiming depth 0 is exactly the unbounded chain
    // `session-own-launch.js › MAX_LAUNCH_DEPTH` exists to stop.
    launchDepth: 0,
    // ⚠ `operatorArmed` IS WHAT LETS THE DURABLE POSTURE REACH AN IDLE SPAWN. `startSession`'s
    // FIX-4 guard refuses a handed-in posture on a `parkedShell` unless a human armed it just
    // now. Here the click on New Agent IS that human, in the same breath as the posture read.
    operatorArmed: true,
  });
  // THE ANSWER IS THE ADDRESS. `agentId` is present on every successful launch.
  if (res && res.agentId) return { ok: true, agentId: res.agentId, sessionId: res.sessionId || null };
  // ⚠ `detail` IS THE SENTENCE WHEN THERE IS ONE (2026-09-22, `no-model`: which models this
  // machine DOES offer). Optional on the wire — an older renderer reads `reason` alone.
  return Object.assign({ ok: false, reason: (res && res.skipped) || 'unknown' },
    res && typeof res.detail === 'string' && res.detail ? { detail: res.detail } : {});
}

/**
 * RECORD A FIRST-USE APPROVAL for another member's identity, on THIS machine.
 *
 * ⚠ IT GRANTS NOTHING BUT THE PROMPT. Approving an identity does not widen a tool profile, a
 * permission axis, a delivery lane or a working folder — it decides whether that identity's TEXT
 * may become this agent's role. The containment an identity runs inside is identical either way.
 * ⚠ IT IS `appWindowOnly` AT THE REGISTRATION SITE, like every other op on that surface, and the
 * store it writes is machine-local and unreachable from any Dopl endpoint. Both halves matter:
 * a server-writable approval lets a credential-holding agent pre-approve itself across the fleet.
 * ⚠ IT IS NOT A LAUNCH. Approving is idempotent and starts nothing; the renderer relaunches.
 */
function approveIdentity(payload) {
  const p = payload || {};
  if (!isUuid(p.identityId)) return { ok: false };
  return { ok: require('./channel-prefs').approveIdentity(p.identityId) === true };
}

module.exports = { launchFromButton, approveIdentity, wantsIdentity };

// THE NEW AGENT BUTTON, END TO END — the body of `sessions:launch`, and its approval twin.
//
// ⚠ SPLIT OUT OF `main/session-ipc-ops.js` ON 2026-08-22, under the hard 500-line §1 cap. That
// file sat at 499: it could absorb ONE line, and the agent-template wiring needs a resolve, a
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
 * ⚠ DID THE CALLER ASK FOR A TEMPLATE AT ALL? Absent, `null` and `''` all mean NO, and a launch
 * that asks for none is BYTE-IDENTICAL to what this lane did before templates existed — no
 * resolve, no round trip, no `context.template`, and `templateRoleFraming` returns `[]`.
 *
 * ⚠ A PRESENT-BUT-MALFORMED ID IS A REFUSAL, NOT A BLANK LAUNCH. The obvious reading of "validate
 * `isUuid(p.templateId) ? p.templateId : null`" quietly turns a garbled id into a blank agent,
 * and F-1's whole argument is that a blank agent silently wearing NO IDENTITY is worse than
 * nothing: the operator picked an identity and will not notice its absence for several turns.
 * `template-resolve.js › resolveTemplate` answers `no-template` for a non-UUID, so the refusal
 * falls out of asking it rather than being a second rule here.
 */
function wantsTemplate(value) {
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
  const sessionModel = require('./session-model');
  // ⚠ CONTAINMENT: the profile comes from MAIN's own watched-channel record — the FULL server
  // DTO off the loop entry (`channel-listener.js › watchedChannel`), never the renderer's claim
  // and ⚠ never the tray's id+name PROJECTION, which is what this read until F-267 (no profile
  // field on it, so EVERY launch here floored). Unwatched, or a DTO missing it: fails closed.
  // ⚠ A TEMPLATE NEVER TOUCHES THIS LINE. A template widens PROMPT CONTENT ONLY: it never
  // supplies, influences or relaxes a containment input — the tool profile, the permission axes,
  // the working folder and the delivery lane stay the machine's, resolved from the machine's own
  // state. That sentence is INVARIANTS §5A's and it is enforced by this ordering: the profile is
  // computed before the template is even fetched, from a source the payload cannot reach.
  const toolProfile = targeting.resolveToolProfile(listener.watchedChannel(p.channelId));
  const workspaceId = typeof p.workspaceId === 'string' ? p.workspaceId : null;

  // ── ⚠ THE LAUNCH SHEET'S EPHEMERAL OVERRIDES, NARROWED FIRST ──────────────────────────────
  //
  // The sheet may re-point THIS SPAWN's model and its custom-field VALUES. Nothing here is
  // written back to the template. It is narrowed BEFORE the resolve because the model half
  // applies to a BLANK launch too — the sheet opens on `Blank agent` as well as on a template —
  // and because `template-resolve.js › narrowOverrides` is where the charset rule the RENDERER
  // cannot reach is enforced (F-281: `@/shared/lib/safe-label` imports zod, so no SPA surface can
  // hold `SAFE_LABEL_RE`, and MAIN is the only real validator of this payload).
  // ⚠ ABSENT IS THE ONLY SPELLING OF "NO OVERRIDE", so an untouched sheet and a plain row click
  // produce byte-identical launches.
  const overrides = require('./template-resolve').narrowOverrides(p.overrides);

  // ── THE TEMPLATE, RESOLVED BY MAIN, AT SPAWN ──────────────────────────────────────────────
  let template = null;
  if (wantsTemplate(p.templateId)) {
    const res = await require('./template-resolve').resolveTemplate(p.templateId, workspaceId);
    // F-1 / F-2 / F-3 / F-4: REFUSE. Never degrade to a blank agent.
    if (!res.ok) return { ok: false, reason: res.reason };
    template = res.template;
    // ── ⚠ FIRST-USE APPROVAL FOR A FOREIGN TEMPLATE (OQ-3) ────────────────────────────────
    //
    // Another member's instructions are about to become standing configuration for an
    // autonomous agent running on THIS machine under THIS operator's credential. One approval,
    // the first time, per template, machine-local (`channel-prefs.js › isTemplateApproved` —
    // read its block for why the store may never be server-reachable).
    //
    // ⚠ IT IS A REFUSAL ROUND TRIP, NOT A MODAL RAISED FROM MAIN. The launch came from a button
    // in the SPA's own window, so the SPA is where the operator already is; main raising its own
    // dialog would put a second, differently-styled approval surface in front of them and would
    // block the IPC reply while it sat there. The renderer shows the sheet, calls
    // `sessions.approveTemplate(templateId)`, and relaunches.
    // ⚠ THE INSTRUCTIONS RIDE BACK so the sheet shows THE TEXT MAIN RESOLVED, verbatim. An
    // approval over a body the renderer fetched separately is an approval over a different
    // document than the one that will run.
    // ⚠ OWN TEMPLATES SKIP THIS ENTIRELY. `authoredByCaller === true` is never asked about — an
    // approval prompt over your own configuration is the noise that teaches people to click
    // through the ones that matter.
    if (!template.authoredByCaller && !channelPrefs.isTemplateApproved(p.templateId)) {
      diag('sessions:launch: foreign template awaiting first-use approval', String(p.templateId).slice(0, 8));
      return {
        ok: false,
        reason: 'template-approval',
        template: { name: template.name, instructions: template.instructions },
      };
    }
    // ⚠ THE FIELD OVERRIDES ARE APPLIED AFTER THE APPROVAL GATE, DELIBERATELY. What the operator
    // is asked to approve is the template's INSTRUCTIONS — the part they did not write — and
    // those are never overridable at launch. Applying the sheet's values first would change
    // nothing about the approval and would put renderer text in front of the question.
    template = require('./template-resolve').applyOverrides(template, overrides);
  }

  const title = typeof p.threadTitle === 'string' ? p.threadTitle.slice(0, 200) : '';
  // ⚠ THE GOAL IS DISPLAY/SEED TEXT ONLY ON THIS LANE and is never sent as a turn — a SPAWN-IDLE
  // session has no first turn at all. It survives because `startSession` builds the initiating-
  // request payload from it, and because a CHANNEL-LEVEL agent has no thread to be told to read.
  // ⚠ A TEMPLATE DOES NOT REPLACE IT, AND IT DOES NOT SUPPRESS THE TEMPLATE. ROLE FIRST, GOAL
  // LAST: the role is WHO YOU ARE and the goal is WHAT TO DO NOW, and the goal reads last,
  // adjacent to FIRST ACTIONS and DELIVERY, which is what the agent acts on.
  const goal = channelLevel
    ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
    : title
      ? `Join the thread "${title}" as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.`
      : 'Join this thread as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.';

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
      // ── ⚠ THE RESOLVED TEMPLATE, CAPTURED AT SPAWN AND NEVER RE-READ ────────────────────
      //
      // `session-launch.js › launch` forwards `context` on a LITERAL WHITELIST and
      // `session-engine.js › startSession` merges `spec.context` onto the session, so this costs
      // ZERO funnel changes and works identically on both launch lanes.
      //
      // ⚠ THE CONSEQUENCE IS THE RIGHT ONE AND IT IS NOT ENFORCED, IT FALLS OUT: A SESSION KEEPS
      // ITS SPAWN-TIME TEMPLATE CONTENT. The resolve happens once, here; the role block is built
      // at WAKE from what was captured now (`session-seed.js › takeFraming`, a one-shot). A
      // template edited between spawn and wake does not change the session, and a template
      // DELETED after spawn does not stop it — the content is on the session object, not a
      // pointer to a row. `null` when no template was asked for, so the framing emits nothing.
      template,
    },
    toolProfile,
    mode: 'interactive',
    windowless: true,
    // THE DURABLE POSTURE, CONSUMED HERE AND NOWHERE ELSE (2026-08-20). ⚠ `tools` was PINNED to
    // 'manual' and the operator's Settings-tab pick was never read on this lane at all. It is a
    // real read now — and this is the ONLY call site, which is what keeps H2 intact: the click on
    // Launch is the human decision this posture applies to. A peer wake, a resume and a recreate
    // still pass nothing and still inherit manual/ask.
    // ⚠ MESSAGES WIDENS, NEVER NARROWS, and it is floored at auto_inbound for the windowless
    // reason (no Accept UI exists).
    startModes: channelPrefs.launchStartModes(p.channelId),
    // ── ⚠ THE MODEL PRECEDENCE CHAIN, COMPUTED IN MAIN AND ONLY IN MAIN ───────────────────
    //
    //   sessions:setModel live override (post-spawn, `session-reopen.js`)
    //     > overrides.model              (the LAUNCH SHEET's deliberate per-call pick)
    //     > template.model               (the template's DEFAULT)
    //     > channelPrefs.getLaunchModel  (the channel's durable pick)
    //     > SDK default                  (`modelArg` returns null ⇒ no --model at all)
    //
    // ⚠ THE SHEET BEATS THE TEMPLATE for the same reason the orchestrator's explicit `model`
    // param beats it on the directive lane: one is a DELIBERATE PER-CALL CHOICE and the other is
    // a DEFAULT. It also applies to a BLANK launch, where there is no template to outrank — the
    // sheet opens on `Blank agent` too, and dropping the pick there would be a control that
    // silently does nothing.
    //
    // ⚠ EACH LINK IS CONSULTED IN TURN AND THE FIRST ONE THAT YIELDS A REAL MODEL WINS. A
    // template naming a model THIS BUILD DOES NOT KNOW yields nothing and falls through to the
    // channel's pick — it does not throw the operator's own default away, and it does not
    // REFUSE. That is F-5: the whole tree's rule is "unknown model falls back, never refuses",
    // because refusing would make a template unusable on a machine running an older desktop
    // build, which is the common case and not the rare one.
    // ⚠ `normalizeModel` accepts BOTH vocabularies (a full id or an alias) and answers exactly
    // one, so a template author may write either. `buildSdkOptions` re-coerces at the last step
    // before argv, so nothing here is trusted downstream either.
    // ⚠ A MODEL GRANTS NOTHING AND REACHES NO GATE, which is why it may travel further than the
    // permission pair. `getLaunchModel` is deliberately not `getLaunchPosture`.
    model: overrides.model || templateModel(sessionModel, template)
      || sessionModel.aliasForModelId(channelPrefs.getLaunchModel(p.channelId)),
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
  return { ok: false, reason: (res && res.skipped) || 'unknown' };
}

/**
 * The template's own model as an ALIAS, or '' when it named none / named one this build does not
 * recognise. ⚠ `''` IS "THE CHAIN CONTINUES", which is why this is not `normalizeModel`'s
 * 'default': that value MEANS "the CLI's own pick" and would end the chain one link early.
 * ⚠ THE RULE ITSELF IS `session-model.js › chainModel` SINCE 2026-08-23, not restated here — the
 * DIRECTIVE lane needs the identical answer for its own link and a rule written once per lane is
 * a rule that drifts in one of them (F-285). This function is now only "which field to read".
 */
function templateModel(sessionModel, template) {
  return sessionModel.chainModel(
    template && typeof template.model === 'string' ? template.model : ''
  );
}

/**
 * RECORD A FIRST-USE APPROVAL for another member's template, on THIS machine.
 *
 * ⚠ IT GRANTS NOTHING BUT THE PROMPT. Approving a template does not widen a tool profile, a
 * permission axis, a delivery lane or a working folder — it decides whether that template's TEXT
 * may become this agent's role. The containment a template runs inside is identical either way.
 * ⚠ IT IS `appWindowOnly` AT THE REGISTRATION SITE, like every other op on that surface, and the
 * store it writes is machine-local and unreachable from any Dopl endpoint. Both halves matter:
 * a server-writable approval lets a credential-holding agent pre-approve itself across the fleet.
 * ⚠ IT IS NOT A LAUNCH. Approving is idempotent and starts nothing; the renderer relaunches.
 */
function approveTemplate(payload) {
  const p = payload || {};
  if (!isUuid(p.templateId)) return { ok: false };
  return { ok: require('./channel-prefs').approveTemplate(p.templateId) === true };
}

module.exports = { launchFromButton, approveTemplate, wantsTemplate, templateModel };

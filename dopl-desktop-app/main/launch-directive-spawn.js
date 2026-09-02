// THE DIRECTIVE LANE'S SPAWN — one claimed row becoming one session, and nothing else.
//
// ⚠ **§1 SPLIT OUT OF `main/launch-directives.js` ON 2026-09-01 (T24), AT THE HARD 500-LINE CAP
// THAT FILE WAS SITTING EXACTLY ON.** The seam is a real one and not a line budget: that module
// is the WATCHER — arming, the realtime binding, the owner re-check, the per-kind consent gate,
// the CAS, the dedupe ledger, the backstop poll — and it changes when the LOCAL POLICY for
// acting on a row changes. This is the LAUNCH ASSEMBLY, and it changes when what a session is
// built out of changes: the containment inputs, the template resolve, the model precedence
// chain, the posture. Two reasons to change, and the second one had grown a posture bound with
// nowhere to put it. Same precedent as `launch-directive-calls.js` (the two authenticated calls)
// and `launch-directive-wire.js` (the shape) leaving the same file for the same cap.
//
// ⚠ **THE CONTAINMENT ARGUMENT CAME WITH IT AND IS STATED ON `spawn` ITSELF**, where the code it
// governs is — that block is the whole §6 answer for this lane and must never be summarized into
// a pointer. What stayed behind is the THREAT MODEL (why the arming switch is local, why the row
// is not the authorization); what is here is the field-by-field statement of where every
// containment input comes from.
//
// ⚠ **`deps` IS INJECTED, NOT SHARED.** The watcher owns the two handles this needs
// (`watchedChannel`, `launch`) and hands them in per call, so this module holds no module state
// of its own and its suite can drive it without arming a watcher.

const channelPrefs = require('./channel-prefs');
const channelRuntime = require('./channel-runtime'); // 2026-08-31: which runtime this channel's agents run on
const wire = require('./launch-directive-wire');
const sessionModel = require('./session-model');
// ⚠ THE POSTURE BOUND (2026-09-01, T24), SHARED WITH THE `set_agent_mode` KIND and pure. A
// directive may now ASK for a start posture and for chaining; `resolveLaunch` is where the asking
// is clamped to the operator's own stored channel pair, and its header carries why the ticket's
// own "unless the caller is the operator" carve-out is the whole set.
const launchPosture = require('./launch-posture');
const { diag } = require('./diag');

/**
 * SPAWN, THROUGH THE ORDINARY FUNNEL. Returns `{ refused: <word> }`, or — on success —
 * `{ agentId, appliedTools, appliedMessages, appliedChain }`, the ECHO the decide reports back
 * (2026-09-01). The three `applied*` values are the RESOLVED ones, never the requested ones; the
 * block at the return statement carries why.
 *
 * ⚠ EVERY CONTAINMENT INPUT COMES FROM THIS MACHINE, NOT FROM THE DIRECTIVE. Stated field by
 * field because this is the whole safety argument:
 *   toolProfile   `channel-listener.js › watchedChannel` — MAIN's own full server DTO off the
 *                 loop entry, the same read `sessions:launch` makes (F-267 fixed it to this) and
 *                 the same one `trigger.js` makes on the responder lane. Unwatched -> refuse.
 *   startModes    the operator's DURABLE per-channel posture (`channel-prefs.js ›
 *                 getLaunchPosture`) as the CEILING, message axis floored at `auto_inbound` for
 *                 the windowless reason. ⚠ SINCE 2026-09-01 (T24) A DIRECTIVE MAY ASK FOR A
 *                 NARROWER PAIR, and `launch-posture.js › resolveLaunch` is the clamp: asking is
 *                 admitted, widening is not, and the ceiling is still the operator's own record.
 *   windowless    literal `true`. There is one spawn shape.
 * The directive supplies `goal`, `model`, a TEMPLATE ID and — since T24 — a posture REQUEST and a
 * chaining REQUEST. None of them reaches a permission decision unclamped: the two requests are
 * bounded by the operator's own stored pair and by their own channel chaining setting, and a
 * chain asked for where the channel forbids it REFUSES rather than launching quietly narrower.
 *
 * ── ⚠ THE TEMPLATE, RESOLVED HERE AND ONLY HERE (2026-08-23) ─────────────────────────────
 * The row carries an ID and a NAME SNAPSHOT; the CONTENT is fetched by THIS machine, at claim
 * time (`template-resolve.js › resolveTemplate`). Three consequences, each deliberate:
 *   1. THE SECOND FENCE IS THE OPERATOR'S. The orchestrator proved it could SEE the template at
 *      create; this proves the OPERATOR can. Routinely different people — a `team` template the
 *      orchestrator is in and the operator is not is created fine and REFUSED here as
 *      `no-template`, which is fail-closed and the designed outcome rather than a bug.
 *   2. `knowledgeBases` IS VIEWER-FILTERED AGAINST WHOEVER RESOLVES, so a shared template cannot
 *      launder access to a private base. 3. REFUSE, NEVER DEGRADE: no branch drops an unresolvable
 *      template and launches blank — a blank agent wearing no identity goes unnoticed.
 *
 * ⚠ NO FIRST-USE APPROVAL ON THIS LANE — a RULING, not an omission (OQ-3). The BUTTON lane's
 * one-modal gate (`session-launch-op.js`, answering its own renderer with `template-approval`)
 * has no equivalent here: there is no human at the keyboard and the toggle already stands in for
 * the click, so `template-approval` has no producer here, is not in the wire vocabulary, and the
 * column cannot store it.
 *
 * ⚠ `operatorArmed: true`, AND IT IS THE TOGGLE THAT EARNS IT. `startSession`'s FIX-4 guard
 * refuses a handed-in posture on a `parkedShell` unless a human armed it just now, because a
 * shell is normally woken by something that is NOT the approving human. Here that human is the
 * operator who turned this lane on, on this machine — Samuel's ruling exactly. ⚠ WITHOUT IT the
 * spawn would drop the operator's own posture and inherit the reducer's `manual` tool axis, which
 * is not "safer" in any useful sense — it is the operator's configured channel behaving
 * differently depending on who pressed, the drift H2's one-consumer rule exists to make visible.
 *
 * ── ⚠ `idle: !d.goal` — A GOAL RUNS, NO GOAL STANDS BY (2026-08-31; ENGINEERING §8 has the repro
 * and the whole argument). It was `idle: true` unconditionally, with the goal held for a WAKE
 * (`s.launchGoal` -> `session-seed.js › takeFraming`). Every link of that worked; the PREMISE did
 * not — **the only caller of this lane cannot produce that wake**, since a dormant session needs
 * a HUMAN-authored message and a directive is filed by an AGENT whose posts `session-wake-tiers
 * .js › wakeEligible` refuses. ⚠ THE FENCE DID NOT MOVE AND MUST NOT; the SPAWN SHAPE did. No-goal
 * keeps the shell (`defaultGoal` is a synthesized stand-by line, not an instruction anybody wrote);
 * `buildFencedTurn` fences the goal on both branches, and only the WHEN differs.
 */
async function spawn(d, deps) {
  const plan = launchPosture.resolveLaunch({
    requested: { tools: d.startToolMode, messages: d.startMessageMode },
    ceiling: channelPrefs.getLaunchPosture(d.channelId),
    chainRequested: d.chain,
    chainAllowed: channelPrefs.getAgentChain(d.channelId),
    floorMessages: (m) => channelPrefs.windowlessMessageMode(d.channelId, m),
    toolOrder: wire.TOOL_MODES, messageOrder: wire.MESSAGE_MODES,
  });
  // ⚠ ANSWERED BEFORE ANY WORK, because the chain request REFUSES where the posture CLAMPS —
  // `launch-posture.js › resolveChain` carries both halves of that asymmetry.
  if (plan.refused) {
    // ⚠ `no-chain`, NOT `no-bridge` (2026-09-02). They were one word until then, and the two facts
    // are opposite instructions: `no-bridge` means this machine has no context for that channel —
    // go elsewhere — while this means the channel is right and ONE SETTING is off. The setting's
    // name travels in the log AND on the wire, because a refusal an orchestrator can only explain
    // by reading this repo is the refusal T24 exists to delete.
    diag('launch-directive: chaining asked for and NOT enabled here —', launchPosture.CHAIN_SETTING,
      'is off for this channel; the operator turns it on in the channel Settings tab');
    return { refused: 'no-chain', setting: launchPosture.CHAIN_SETTING };
  }
  if (plan.clamped) {
    diag('launch-directive: posture CLAMPED to this channel\'s stored pair — asked',
      String(d.startToolMode || '-') + '/' + String(d.startMessageMode || '-'),
      'applied', plan.modes.tools + '/' + plan.modes.messages);
  }
  const channel = deps.watchedChannel ? deps.watchedChannel(d.channelId) : null;
  if (!channel) {
    // ⚠ NOT WATCHING THIS CHANNEL IS A REFUSAL, NOT A CRASH, and `no-bridge` is the honest word:
    // this machine has no context for that channel, so it has nothing to launch INTO. Failing
    // closed here is also what stops a directive naming an arbitrary channel id from reaching a
    // spawn with a fail-closed `read_only` profile and looking like it worked.
    return { refused: 'no-bridge' };
  }
  const targeting = require('./targeting');
  const channelLevel = d.taskId === '';

  // ── THE TEMPLATE, UNDER THIS OPERATOR'S CREDENTIAL ─────────────────────────────────────
  // ⚠ AFTER the watched-channel lookup and BEFORE `deps.launch` — the order IS the containment
  // statement: the tool profile is already decided by the time any template text exists here.
  let template = null;
  if (d.templateId) {
    const resolved = await require('./template-resolve').resolveTemplate(d.templateId, d.workspaceId);
    // ⚠ `resolved.reason` IS ALREADY ONE OF THE WIRE WORDS — `no-template` for a 404 (deleted,
    // invisible to THIS operator, or IN ANOTHER TENANCY: `d.workspaceId` is the CHANNEL's
    // container, so a template this operator owns elsewhere is ABSENT from that read, not
    // hidden), `busy` for a timeout, a network failure or a 5xx. 404-never-403 makes the first
    // two one answer and this machine must not try to tell them apart. Passed through rather
    // than re-mapped: `decideBody › refusalFor` is the closed-vocabulary gate — which is also
    // why the T35 tenancy note `template-resolve.js` logs cannot travel; the RULE crosses
    // instead of the row, in `channel-doctrine.ts › TENANCY_RULE`.
    if (!resolved.ok) return { refused: resolved.reason };
    template = resolved.template;
  } else if (d.templateName) {
    // ⚠ E-4 — THE DELETION SIGNAL, AND IT REFUSES WITHOUT A RESOLVE ATTEMPT. `template_id` is
    // `ON DELETE SET NULL`, so a template deleted between CREATE and CLAIM leaves the id null and
    // the NAME standing. There is no id left to ask about. On the id alone this machine cannot
    // tell "no template requested" from "template deleted" — which is why the server snapshots
    // the name — and the answer to a deletion is REFUSE, never a blank launch.
    diag('launch-directive: template deleted before claim —', String(d.templateName).slice(0, 40));
    return { refused: 'no-template' };
  }

  // ── THE PINNED STARTUP CONTEXT, UNDER THIS OPERATOR'S CREDENTIAL (T81) ────────────────
  // ⚠ AFTER the template, and for the SAME ordering reason: the tool profile and the identity are
  // both already decided by the time any workspace prose exists here.
  // ⚠ **AND IT IS THE ONE FETCH ON THIS LANE THAT CANNOT REFUSE THE LAUNCH.** `fetchStartupContext`
  // answers `null` on every failure — timeout, network, 5xx, an older server's 404 — because a
  // startup context is ENRICHMENT and a template is an IDENTITY. Its docblock carries the whole
  // argument; the shape of the difference is right here, in the missing `if (!…) return { refused }`.
  const startupContext = await fetchStartupContext(d.workspaceId);

  const res = await deps.launch({
    channelId: d.channelId,
    taskId: d.taskId,
    workspaceId: d.workspaceId || null,
    // ⚠ THE CHANNEL'S RUNTIME, INHERITED (2026-08-31, port wave D) — `trigger.js ›
    // launchResponderSession` carries the whole argument for why this record travels where the
    // permission pair may not. An orchestrator's directive is a lane with no human at the
    // keyboard, so it inherits the channel's setting exactly as it inherits the tool profile and
    // the model: picking a runtime widens nothing, and a directive answered on a vendor the
    // operator never chose is the surprise the port exists to avoid. Absent => the default.
    runtime: channelRuntime.getChannelRuntime(d.channelId),
    goal: d.goal || defaultGoal(channelLevel),
    counterpartyId: null,
    direct: false,
    context: {
      channelName: String(channel.name || '').slice(0, 120),
      taskTitle: null,
      channelId: d.channelId,
      workspaceId: d.workspaceId || null,
      taskId: d.taskId,
      scope: channelLevel ? 'channel' : 'thread',
      workspaceSegment: null,
      // ── ⚠ THE RESOLVED TEMPLATE, CAPTURED AT SPAWN AND NEVER RE-READ ───────────────────
      // The SAME `context.template` key the button lane uses — `session-launch.js › launch`
      // forwards `context` on a literal whitelist and `startSession` merges it — so this costs
      // zero funnel changes: one resolution point, two lanes, one consumer
      // (`prompt-framing-template.js › templateRoleFraming`).
      // ⚠ A SESSION KEEPS ITS SPAWN-TIME TEMPLATE CONTENT, and that FALLS OUT rather than being
      // enforced: the role block is built at WAKE from what was captured here, so a template
      // edited or deleted afterwards neither changes nor stops this session (E-1 / E-2).
      // ⚠ `null` when none was named — `templateRoleFraming` returns `[]` and the turn is
      // byte-identical to what this lane produced before templates existed.
      template,
      // ── ⚠ THE PINNED WORKSPACE CONTEXT, CAPTURED AT SPAWN AND NEVER RE-READ (T81) ─────
      // Same key discipline as `template` above — `session-launch.js › launch` forwards `context`
      // and `session-engine.js` spreads it onto the session, so this costs zero funnel changes and
      // has ONE consumer (`prompt-framing-startup.js › startupContextFraming`).
      // ⚠ `null` WHEN NOTHING IS PINNED **AND** WHEN THE FETCH FAILED, and those two are one state
      // deliberately: the framer returns `[]` for either, so the turn is byte-identical to what
      // this lane produced before T81. `fetchStartupContext` carries why a failure is not reported
      // into the prompt.
      startupContext,
    },
    toolProfile: targeting.resolveToolProfile(channel),
    mode: 'interactive',
    windowless: true,
    startModes: plan.modes, // T24: the operator's stored pair, or a narrower one the directive asked for
    // ── ⚠ THE MODEL PRECEDENCE CHAIN, DIRECTIVE LANE (spec §3c) ────────────────────────────
    //   directive.model  >  template.model  >  channelPrefs.getLaunchModel  >  SDK default
    //                                                     (`modelArg` null ⇒ no --model at all)
    //
    // ⚠ THE ORCHESTRATOR'S EXPLICIT `model` BEATS THE TEMPLATE'S, for the same reason the launch
    // sheet does on the button lane: one is a deliberate per-call choice, the other a default.
    // The template's named position is BELOW it and ABOVE the channel, and nowhere else.
    // ⚠ EVERY LINK IS `chainModel` — "a real pick, or '' meaning KEEP GOING" — INCLUDING THE
    // DIRECTIVE'S OWN (F-285, 2026-08-23). It used to be a ternary coercing `d.model` through
    // `aliasForModelId`, which knows FULL IDS ONLY: a legitimate alias like `opus` (a member of
    // `MODEL_CHOICES`, the value this tree spends as argv) collapsed to `'default'`, committed the
    // ternary, and threw the template's AND the channel's picks away. An unrecognised id now FALLS
    // THROUGH, which is what `channel-schema.ts › model` promises ("silently FALLS BACK to whatever
    // the channel is set to") and what INVARIANTS §10's `launch_agent` bullet records — F-5's
    // tree-wide rule on every link: unknown model falls back, never refuses.
    model: sessionModel.chainModel(d.model)
      || require('./session-launch-op').templateModel(sessionModel, template)
      || sessionModel.aliasForModelId(channelPrefs.getLaunchModel(d.channelId)),
    launchChain: plan.chain, idle: !d.goal, // ⚠ `launchChain` (2026-08-31, Samuel's agent-chaining ruling): THIS lane is the ONLY caller that passes it, read PER DIRECTIVE and never cached (the operator may flip the channel setting between two of them), so a session started here may launch further agents exactly when the room says so — every other lane passes nothing, reads false, and keeps the one-generation bound. ⚠ `idle`: docblock; `directiveFrom` trimmed the goal, so '' is the only spelling of "none"
    operatorArmed: true, // ⚠ both branches: FIX-4 reads it only for a shell, but it is true either way
  });
  // ── ⚠ THE ECHO, RETURNED BESIDE THE ADDRESS (2026-09-01, T24's second half) ───────────────
  // `decideBody` puts these three on the LAUNCHED body and the server stores them in
  // `applied_tool_mode` / `applied_message_mode` / `applied_chain`, where
  // `channel-ops-launch.ts › postureFacts` renders them.
  // ⚠ **THEY ARE `plan`'s VALUES, NEVER `d`'s.** `d.startToolMode` / `d.startMessageMode` /
  // `d.chain` are what the ORCHESTRATOR ASKED FOR; `plan.modes` / `plan.chain` are what this
  // machine SETTLED ON after the clamp, the windowless floor and the chain rule — and they are the
  // same objects handed to `deps.launch` above, so the report cannot drift from the session.
  // Echoing the request instead would be right whenever nothing was clamped and confidently wrong
  // exactly when it mattered, which is the one claim this lane must never make.
  // ⚠ REPORTED ON EVERY LAUNCH, NOT ONLY A CLAMPED ONE. "Not reported" has to keep meaning "this
  // machine said nothing" (an older desktop), so a machine that CAN report and stays silent
  // whenever it agrees would make silence ambiguous.
  if (res && res.agentId) {
    return {
      agentId: res.agentId,
      appliedTools: plan.modes.tools,
      appliedMessages: plan.modes.messages,
      appliedChain: plan.chain,
    };
  }
  return { refused: wire.refusalFor(res && res.skipped) };
}

// ⚠ SHORTER THAN `launch-directive-calls.js`'s `HTTP_TIMEOUT_MS` (15 s), and the reason is the
// difference between a REFUSAL and an ENRICHMENT: a claim that times out costs the orchestrator a
// wait, while this one costs a launch that is otherwise ready to go. Five seconds is the same
// budget `template-resolve.js` spends for the same "do not hold a spawn open" reason.
const STARTUP_CONTEXT_TIMEOUT_MS = 5000;

/**
 * THE PINNED STARTUP CONTEXT (T81) — `GET /api/knowledge/startup-context`, at spawn, under THIS
 * OPERATOR's credential. Returns the payload, or `null`. **NEVER THROWS AND NEVER REFUSES.**
 *
 * ⚠ **THE ERROR DISCIPLINE IS THE TEMPLATE RESOLVE'S SHAPE WITH THE OPPOSITE VERDICT, AND THE
 * DIFFERENCE IS THE WHOLE REASON THIS COMMENT EXISTS.** `template-resolve.js` returns a REFUSAL
 * word and this file's `spawn` turns it into `no-template`, because a template is an IDENTITY the
 * caller deliberately chose: an agent silently wearing none is not noticed for several turns, so
 * "refuse, never degrade" is right there.
 * ⚠ A STARTUP CONTEXT IS **ENRICHMENT**, so the same failure must NOT refuse. It is standing
 * reference material the workspace pinned for every session, not something this directive asked
 * for; refusing the launch would mean an unreachable knowledge route, a slow one, or a server too
 * old to have the endpoint takes down agent launching altogether — a hard failure bought for a
 * soft benefit. It degrades to ABSENT (the pre-T81 turn, byte for byte) and says so via `diag`.
 * ⚠ **AND ABSENT IS INDISTINGUISHABLE FROM "NOTHING IS PINNED", DELIBERATELY.** There is no
 * prompt line saying "your workspace may have pinned something I could not fetch": that sentence
 * is unactionable by the agent, and a session that has it would report a machine-local blocker
 * into a shared channel, which is exactly what `prompt-framing.js › counterpartyFraming` exists
 * to stop. The operator sees it in `diag`; the agent sees the pre-T81 turn.
 */
async function fetchStartupContext(workspaceId) {
  try {
    const res = await require('./api').apiFetch('/api/knowledge/startup-context', {
      method: 'GET',
      // ⚠ THE CHANNEL'S CONTAINER, not "the operator's active workspace". `apiFetch` sends this as
      // `X-Workspace-Id`, and a launch into a home channel's own container must read THAT
      // container's pins — the same scoping the template resolve on this lane takes.
      workspaceId: typeof workspaceId === 'string' && workspaceId ? workspaceId : undefined,
      timeoutMs: STARTUP_CONTEXT_TIMEOUT_MS,
      noStore: true,
    });
    // ⚠ A 404 IS THE OLDER-DEPLOYMENT CASE AND IS NOT AN ERROR (INVARIANTS §13 — an older peer is
    // supported), which is the same reading `launch-directive-wire.js`'s `pollWorkspace` note
    // gives its own 404. It lands on the identical degrade as every other failure.
    if (!res || !res.ok) {
      diag('startup-context: not fetched —', res ? `HTTP ${res.status}` : 'no response',
        '— launching without pinned context');
      return null;
    }
    const body = await res.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return null;
    // ⚠ NARROWED, NOT SPREAD, for `template-resolve.js › narrow`'s reason: a key the server adds
    // later must not arrive on a session object and start being depended on by accident. The
    // per-field BOUNDS are the render's (`prompt-framing-startup.js`), where the neutralizers are.
    return { items: body.items, omitted: Array.isArray(body.omitted) ? body.omitted : [] };
  } catch (err) {
    // An abort (the timeout) and a dead socket land here identically, and so they should.
    diag('startup-context: network —', (err && err.message) || 'error',
      '— launching without pinned context');
    return null;
  }
}

/** The goal a directive with none falls back to — the same sentence the New Agent button
 *  composes, because a directive with no goal is asking for exactly that agent. */
function defaultGoal(channelLevel) {
  return channelLevel
    ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
    : 'Join this thread as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.';
}

module.exports = { spawn, defaultGoal };

// THE DIRECTIVE LANE'S SPAWN — one claimed row becoming one session, and nothing else.
//
// §1 SPLIT out of `main/launch-directives.js` on 2026-09-01 (T24), at the hard 500-line cap. The
// seam is real: that module is the WATCHER (arming, the realtime binding, the owner re-check, the
// per-kind consent gate, the CAS, the dedupe ledger, the backstop poll) and changes when the LOCAL
// POLICY for acting on a row changes; this is the LAUNCH ASSEMBLY and changes when what a session
// is built out of changes. Same precedent as `launch-directive-calls.js` and
// `launch-directive-wire.js`.
//
// The containment argument came with it and is stated on `spawn` itself, where the code it governs
// is — that block is the whole §6 answer for this lane and must never be summarized into a pointer.
// What stayed behind is the THREAT MODEL (why the arming switch is local, why the row is not the
// authorization).
//
// `deps` IS INJECTED, NOT SHARED: the watcher owns the two handles this needs and hands them in per
// call, so this module holds no module state and its suite can drive it without arming a watcher.

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
 * (2026-09-01). The three `applied*` values are the RESOLVED ones, never the requested ones.
 *
 * EVERY CONTAINMENT INPUT COMES FROM THIS MACHINE, NOT FROM THE DIRECTIVE. Stated field by field
 * because this is the whole safety argument:
 *   toolProfile   `channel-listener.js › watchedChannel` — MAIN's own full server DTO off the loop
 *                 entry, the same read `sessions:launch` makes (F-267) and `trigger.js` makes on
 *                 the responder lane. Unwatched -> refuse. Since 2026-09-02 (ruling B7) it is then
 *                 NARROWED, never widened: a launch into a SHARED container resolves `full` to
 *                 `channel_agent` — `full` minus the shell — because an agent with a shell and its
 *                 own bearer reaches the REST API directly. The fact comes from this machine's own
 *                 roster memo, never the row.
 *   startModes    the operator's DURABLE per-channel posture (`channel-prefs.js ›
 *                 getLaunchPosture`) as the CEILING, message axis floored at `auto_inbound` for the
 *                 windowless reason. Since T24 a directive may ASK for a NARROWER pair, and
 *                 `launch-posture.js › resolveLaunch` is the clamp: asking is admitted, widening is
 *                 not, and the ceiling is still the operator's own record.
 *   windowless    literal `true`. There is one spawn shape.
 * The directive supplies `goal`, `model`, a TEMPLATE ID and — since T24 — a posture REQUEST and a
 * chaining REQUEST. None reaches a permission decision unclamped, and a chain asked for where the
 * channel forbids it REFUSES rather than launching quietly narrower.
 *
 * THE TEMPLATE IS RESOLVED HERE AND ONLY HERE (2026-08-23). The row carries an ID and a NAME
 * SNAPSHOT; the CONTENT is fetched by THIS machine at claim time (`template-resolve.js ›
 * resolveTemplate`). Three deliberate consequences: the SECOND FENCE IS THE OPERATOR'S (the
 * orchestrator proved it could SEE the template, this proves the operator can — a `team` template
 * the operator is not in is created fine and refused here as `no-template`, fail-closed and
 * designed); `knowledgeBases` is VIEWER-FILTERED against whoever resolves, so a shared template
 * cannot launder access to a private base; and REFUSE, NEVER DEGRADE, because a blank agent wearing
 * no identity goes unnoticed.
 *
 * NO FIRST-USE APPROVAL ON THIS LANE — a ruling, not an omission (OQ-3). The button lane's one-modal
 * gate has no equivalent here: there is no human at the keyboard and the toggle already stands in
 * for the click, so `template-approval` has no producer here and is not in the wire vocabulary.
 *
 * `operatorArmed: true`, AND IT IS THE TOGGLE THAT EARNS IT. `startSession`'s FIX-4 guard refuses a
 * handed-in posture on a `parkedShell` unless a human armed it just now; here that human is the
 * operator who turned this lane on, on this machine. Without it the spawn would drop the operator's
 * own posture and inherit the reducer's `manual` tool axis — not "safer", just the operator's
 * configured channel behaving differently depending on who pressed.
 *
 * `idle: !d.goal` — A GOAL RUNS, NO GOAL STANDS BY (2026-08-31; ENGINEERING §8 has the repro). It
 * was `idle: true` unconditionally, with the goal held for a WAKE; every link worked but the
 * PREMISE did not — the only caller of this lane cannot produce that wake, since a dormant session
 * is woken by an ADDRESS and a directive is filed by an AGENT, whose unaddressed posts
 * `session-dispatch.js › mayWake` refuses. The FENCE did not move and must not; the SPAWN SHAPE
 * did. `buildFencedTurn` fences the goal on both branches, and only the WHEN differs.
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
    // `no-chain`, NOT `no-bridge` (2026-09-02): the two facts are opposite instructions —
    // `no-bridge` means this machine has no context for that channel, while this means the channel
    // is right and ONE SETTING is off. The setting's name travels in the log AND on the wire,
    // because a refusal an orchestrator can only explain by reading this repo is what T24 deletes.
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
    // NOT WATCHING THIS CHANNEL IS A REFUSAL, NOT A CRASH, and `no-bridge` is the honest word: this
    // machine has no context for that channel, so it has nothing to launch INTO. Failing closed here
    // also stops a directive naming an arbitrary channel id from reaching a spawn with a
    // fail-closed `read_only` profile and looking like it worked.
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
    // `resolved.reason` is already one of the wire words — `no-template` for a 404 (deleted,
    // invisible to THIS operator, or IN ANOTHER TENANCY: `d.workspaceId` is the CHANNEL's container,
    // so a template this operator owns elsewhere is ABSENT from that read), `busy` for a timeout,
    // network failure or 5xx. 404-never-403 makes the first two one answer and this machine must not
    // try to tell them apart. Passed through rather than re-mapped: `decideBody › refusalFor` is the
    // closed-vocabulary gate.
    if (!resolved.ok) return { refused: resolved.reason };
    template = resolved.template;
  } else if (d.templateName) {
    // E-4 — THE DELETION SIGNAL, AND IT REFUSES WITHOUT A RESOLVE ATTEMPT. `template_id` is
    // `ON DELETE SET NULL`, so a template deleted between CREATE and CLAIM leaves the id null and
    // the NAME standing — which is why the server snapshots the name, since on the id alone this
    // machine cannot tell "no template requested" from "template deleted".
    diag('launch-directive: template deleted before claim —', String(d.templateName).slice(0, 40));
    return { refused: 'no-template' };
  }

  const res = await deps.launch({
    channelId: d.channelId,
    taskId: d.taskId,
    workspaceId: d.workspaceId || null,
    // THE CHANNEL'S RUNTIME, INHERITED (2026-08-31, port wave D) — `trigger.js ›
    // launchResponderSession` carries the argument for why this record travels where the permission
    // pair may not. A directive lane has no human at the keyboard, so it inherits the channel's
    // setting exactly as it inherits the tool profile and the model. Absent => the default.
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
      // THE RESOLVED TEMPLATE, CAPTURED AT SPAWN AND NEVER RE-READ. The SAME `context.template` key
      // the button lane uses, so this costs zero funnel changes: one resolution point, two lanes,
      // one consumer (`prompt-framing-template.js › templateRoleFraming`). A session keeping its
      // spawn-time template content FALLS OUT rather than being enforced — the role block is built
      // at WAKE from what was captured here, so a template edited or deleted afterwards neither
      // changes nor stops this session (E-1 / E-2). `null` when none was named.
      template,
    },
    // THE CHANNEL'S PROFILE, NARROWED FOR A SHARED ROOM (2026-09-02, ruling B7). The READ is
    // unchanged and is still MAIN's own full server DTO; what is new is one NARROWING, which can
    // only ever move `full` -> `channel_agent`. ONE CALL, and the other two launch lanes make the
    // same one — the rule used to be spelled beside this resolver alone, so the New Agent button and
    // the responder trigger kept their shell in a room this lane bounded (F-510). THE DIRECTIVE
    // STILL SUPPLIES NOTHING HERE: a profile has never been a directive field and does not become
    // one — this is the DESTINATION's property, read on this machine.
    toolProfile: targeting.resolveLaunchToolProfile(channel),
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
    // EVERY LINK IS `chainModel` — "a real pick, or '' meaning KEEP GOING" — INCLUDING THE
    // DIRECTIVE'S OWN (F-285, 2026-08-23). It used to be a ternary coercing `d.model` through
    // `aliasForModelId`, which knows FULL IDS ONLY, so a legitimate alias like `opus` collapsed to
    // `'default'`, committed the ternary, and threw the template's AND the channel's picks away. An
    // unrecognised id now FALLS THROUGH — F-5's tree-wide rule: unknown model falls back, never
    // refuses.
    model: sessionModel.chainModel(d.model)
      || require('./session-launch-op').templateModel(sessionModel, template)
      || sessionModel.aliasForModelId(channelPrefs.getLaunchModel(d.channelId)),
    // THE COLOUR THE ORCHESTRATOR ASKED FOR (Samuel, 2026-09-13; docs/specs/agent-colors.md).
    // `dopl_channel(op="manage", action="launch", color=…)` reaches this lane as a directive column
    // and nowhere else — a parameter the server accepts and the spawning machine cannot see would be
    // worse than no parameter. NO PRECEDENCE CHAIN, unlike `model` above, and the asymmetry is the
    // point: a colour is UNIQUE among a channel's live agents across EVERY member, so a remembered
    // default is a default that collides the second time it is used. Empty means "the server picks
    // the first free key". What arrives here may already be STALE by design — the 409 at create time
    // is a courtesy, never a reservation — so this lane APPLIES it and never verifies it.
    color: d.color,
    launchChain: plan.chain, idle: !d.goal, // ⚠ `launchChain` (2026-08-31, Samuel's agent-chaining ruling): THIS lane is the ONLY caller that passes it, read PER DIRECTIVE and never cached (the operator may flip the channel setting between two of them), so a session started here may launch further agents exactly when the room says so — every other lane passes nothing, reads false, and keeps the one-generation bound. ⚠ `idle`: docblock; `directiveFrom` trimmed the goal, so '' is the only spelling of "none"
    operatorArmed: true, // ⚠ both branches: FIX-4 reads it only for a shell, but it is true either way
  });
  // THE ECHO, RETURNED BESIDE THE ADDRESS (2026-09-01, T24's second half). `decideBody` puts these
  // three on the LAUNCHED body and the server stores them in `applied_tool_mode` /
  // `applied_message_mode` / `applied_chain`.
  //
  // They are `plan`'s values, NEVER `d`'s: `d.*` is what the ORCHESTRATOR ASKED FOR, `plan.*` is
  // what this machine SETTLED ON after the clamp, the windowless floor and the chain rule — the same
  // objects handed to `deps.launch`, so the report cannot drift from the session. REPORTED ON EVERY
  // LAUNCH, not only a clamped one, so that "not reported" keeps meaning "this machine said
  // nothing" (an older desktop) rather than becoming ambiguous.
  if (res && res.agentId) {
    // THE NAME (Samuel, 2026-09-15: agents spinning up agents should be the ones naming them, and
    // never with the id as the name).
    //
    // AFTER the launch, not before, because the name is keyed on the AGENT ID and there is no id
    // until `deps.launch` answers. `agent-names.js` is keyed by the INSTANCE address, which is why a
    // rename survives a park, a lazy resume and a crash resume. `New Agent` is the fallback for a
    // directive with no name (a client older than `20261006120000`, §13's supported peer). Through
    // `commitRename`, never `agent-names.js` directly: that wrapper also touches the summary, and a
    // name that never reaches the projection is a name the @-picker and every peer's card do not
    // have. A refusal is NOT a failed launch. The STORED name is reported back, because it may not
    // be the one asked for (the uniqueness rule may have stored `Coder-1`).
    let applied = null;
    try {
      // THE FALLBACK IS LOGGED, because a nameless agent used to be indistinguishable from a named
      // one here (F-708, 2026-09-16). `'' -> New Agent` is the older-client arm and is legitimate,
      // but it is ALSO what a NAME LOST UPSTREAM looks like — and that is what had happened: the API
      // route dropped `agentName` before the row was written, so this line ran the fallback on every
      // launch and said nothing. The name the directive carried separates the two.
      const asked = d.agentName || '';
      if (!asked) {
        diag('launch-directive: directive carried NO agent name — falling back to',
          NEW_AGENT_NAME, '(an older client sends none; a NEWER one that asked for a name and'
          + ' landed here has lost it upstream of this machine)');
      }
      const stored = require('./agent-identity-commit')
        .commitRename(res.agentId, asked || NEW_AGENT_NAME);
      applied = stored && stored.ok ? stored.name : null;
      // THE REFUSAL ARM, WHICH LOGGED NOTHING AT ALL. `commitRename` answers
      // `agent-self-ops.js › applyRenameTo`'s verdict, and a sanitizer refusal is `ok: false` — so
      // an agent could run unnamed with no line anywhere, and `appliedAgentName` went back as null,
      // which `channel-ops-launch.ts` renders by ECHOING THE REQUEST: the launcher reads the name it
      // asked for while the machine stored none. Still not a failed launch — a line, not a verdict.
      if (!applied) {
        diag('launch-directive: the agent name was REFUSED by the store —',
          (stored && stored.reason) || 'no reason given',
          '— agent', res.agentId, 'is running UNNAMED');
      }
    } catch (err) {
      diag('launch-directive: could not store the agent name —', err && err.message);
    }
    return {
      agentId: res.agentId,
      appliedTools: plan.modes.tools,
      appliedMessages: plan.modes.messages,
      appliedChain: plan.chain,
      appliedAgentName: applied,
    };
  }
  return { refused: wire.refusalFor(res && res.skipped) };
}

/**
 * THE FACE AN UNNAMED AGENT WEARS (Samuel, 2026-09-15: an agent launched with no name is called
 * `New Agent`) — HAND-COPIED from `src/shared/lib/agent-name.ts › NEW_AGENT_NAME`, which main
 * cannot import. Its only reader here is the directive lane's older-client arm.
 */
const NEW_AGENT_NAME = 'New Agent';

/** The goal a directive with none falls back to — the same sentence the New Agent button
 *  composes, because a directive with no goal is asking for exactly that agent. */
function defaultGoal(channelLevel) {
  return channelLevel
    ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
    : 'Join this thread as my agent: read it with dopl_channel (op "read", thread=<id>) and carry the work forward.';
}

module.exports = { spawn, defaultGoal };

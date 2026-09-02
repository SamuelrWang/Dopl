// THE LAUNCH-DIRECTIVE WATCHER — an ORCHESTRATOR asks, this machine decides, and the local
// toggle is the decision (2026-08-22, Samuel's launch-over-MCP ruling).
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────────────────
//
// An agent holding this operator's own Dopl credential writes a row into
// `channel_launch_directives` saying "start an agent on this channel with this goal". This
// module watches for those rows, CLAIMS one, spawns the session through the ordinary funnel, and
// writes back what happened. It is the only path by which anything other than a human click
// starts a session on this Mac.
//
// ⚠ AND **LAUNCHING** IS OFF UNLESS THE OPERATOR TURNED IT ON, PER MACHINE. `channel-prefs.js ›
// getOrchestratorLaunch` defaults FALSE and is reachable from exactly one `appWindowOnly` IPC
// pair — no route, no MCP op, no column. **THE TOGGLE IS THE CONSENT**, and Samuel ruled it as
// the replacement for "the click IS that human" on this lane: there is no click at directive
// time, so the operator's standing local decision has to be the human, and a consent a program
// can grant itself is not one.
//
// ── ⚠ THE MAILBOX CARRIES THREE VERBS SINCE 2026-09-01, AND ONLY ONE IS BEHIND THAT TOGGLE ──
// Samuel's external end/rename ruling. `end_agent` / `rename_agent` existed only INSIDE a spawned
// session (`agent-self-ops.js`), so an EXTERNAL agent holding this operator's credential could
// start agents and never stop or label them. They now ride this lane as `kind = 'end' | 'rename'`
// and dispatch to `directive-agent-ops.js`, which routes to the SAME paths the in-process verbs
// use. **NEITHER IS GATED BY THE LAUNCH TOGGLE** — that module's header carries the argument in
// full (a STOP verb and a DISPLAY verb widen nothing; the toggle gates LOCAL COMPUTE BEING SPENT)
// and names it as the assumption most worth overruling. TWO LINES HERE implement it: the
// `d.kind === KIND_LAUNCH` test in `handle`, and `refresh` binding realtime on `armed`.
// ⚠ THE §6 THREAT MODEL BELOW IS UNCHANGED AND STILL GOVERNS THE LAUNCH BRANCH — the other two
// kinds cannot spawn, cannot widen a profile and cannot reach a credential, which is precisely
// why they sit outside it.
//
// ── ⚠ THE §6 THREAT THIS SHAPE IS BUILT AROUND ───────────────────────────────────────────
//
// A spawned session runs on this Mac as this user, under the channel's tool profile — which
// under `bypass` pre-approves `Bash` — and this operator's device token is on disk. So the agent
// this lane creates can read the credential that would let it write MORE directives. That is not
// hypothetical containment theatre; it is the ordinary shape of the thing.
//
// EVERYTHING BELOW FOLLOWS FROM IT:
//   • THE ARMING SWITCH IS NOT ON THE SERVER. If it were, an agent holding the operator's own
//     credential could arm every machine the operator owns, and the lane would be
//     self-authorizing. It is a local `electron-store` boolean, by ruling.
//   • THE DIRECTIVE SUPPLIES **GOAL**, **MODEL** AND **WHICH TEMPLATE**, AND NOTHING ELSE. Not
//     the permission axes, not the tool profile, not the working folder. Those come from the
//     operator's own durable per-channel record and from main's own watched-channel DTO — the
//     same two sources the Launch button reads. **A directive-driven agent is exactly as
//     contained as a button-driven one**, and nothing an orchestrator writes can widen it.
//     ⚠ **A TEMPLATE WIDENS PROMPT CONTENT ONLY. It never supplies, influences, or relaxes a
//     containment input — tool profile, permission axes, working folder and delivery lane are
//     still the machine's, resolved from the machine's own state.** INVARIANTS §5A's sentence,
//     enforced by `spawn`'s ORDER: the profile is computed from `watchedChannel` BEFORE any
//     template text exists. ⚠ AND THE DIRECTIVE CARRIES AN **ID**, NEVER CONTENT — resolved here
//     under THIS OPERATOR's credential, so one they cannot see is refused (`no-template`).
//   • THE ROW IS NOT THE AUTHORIZATION. The realtime frame is a prompt, not a permit: this
//     module CLAIMS over an authenticated route before it acts on a single field. See below.
//
// ── ⚠ THE REALTIME FILTER IS WORKSPACE-WIDE, AND RLS IS NOT THE SAME FENCE ───────────────
//
// The binding is `workspace_id=eq.<id>` (`realtime.js › addChannel`), matching the
// `channel_messages` one beside it. RLS makes the SELECT owner-only, so a frame for a
// colleague's directive should not reach this client — but "should not" is a policy on a table
// this desktop does not own, evaluated by a service this desktop does not run, and the frame
// filter itself does not encode the operator at all. So `operatorUserId` is re-checked LOCALLY
// against the live identity before anything happens, and the claim re-checks it server-side
// anyway. Two fences, because the cost of the outer one being wrong is another member's
// orchestrator steering this machine.
// ⚠ AND THE POLLED HALF NEEDS THE SAME FIELD — F-284: the server DTO omitted it, so every row
// `pollWorkspace` fetched failed this re-check. `service-launch.ts › toDirective` carries it now.
//
// ── HOW A DIRECTIVE IS ACTED ON ──────────────────────────────────────────────────────────
//
//   1. ARRIVE   a realtime INSERT frame, or the 60s backstop poll when push is down.
//   2. IGNORE   toggle off -> silently, with no server write at all. ⚠ THE SILENCE IS THE
//               DESIGN: the row expires server-side, which the orchestrator SEES, and that beats
//               a refusal — a refusal from a machine that has not opted in is an admission that
//               the machine is listening.
//   3. MINE?    `operatorUserId` against the live identity. Not mine -> silent, as above.
//   4. CLAIM    a CAS on the server row. ⚠ LOSING IS A NORMAL NO-OP, NOT AN ERROR: the operator
//               may have four machines watching the same workspace and exactly one of them
//               should launch. Whoever loses stops, quietly.
//   5. RESOLVE  the TEMPLATE, if one was named — this operator's credential, this machine's call.
//               404 -> `no-template`; timeout/5xx -> `busy`; a NULLED id beside a live NAME is a
//               DELETION and refuses without asking (E-4).
//   6. LAUNCH   through `session-engine.launchRequesterSession`, the same funnel the button uses.
//               WITH a goal it RUNS; without one it registers a spawn-idle shell (see `spawn`).
//   7. DECIDE   `launched` + the agent id, or `refused` + one of the seven words. Exactly one of
//               them, always — see `launch-directive-wire.js › decideBody`.
//
// ⚠ IDEMPOTENCE IS BELT AND BRACES. The server CAS is the real guarantee; `decided` below is the
// local belt — a realtime frame and a backstop poll can deliver the same row within milliseconds
// of each other, and the claim is a network round-trip wide.
//
// The wire shapes and the route paths live in `launch-directive-wire.js`, which states which of
// them are the OTHER lane's contract and which are this tree's own vocabulary.

const { apiFetch } = require('./api');
const realtime = require('./realtime');
const channelPrefs = require('./channel-prefs');
const channelRuntime = require('./channel-runtime'); // 2026-08-31: which runtime this channel's agents run on
const wire = require('./launch-directive-wire');
const sessionModel = require('./session-model');
const { diag } = require('./diag');

const HTTP_TIMEOUT_MS = 15000;

// ⚠ THE BACKSTOP IS FOR THE BREAKER, NOT FOR CORRECTNESS. When realtime is healthy this poll
// does nothing at all — it checks `isWorkspaceHealthy` first and returns. It exists because a
// directive is a REQUEST somebody is waiting on, and `realtime.js`'s breaker holds a long
// cooldown by design: without this, arming the lane and then flapping the WS would leave an
// orchestrator waiting for the row's whole expiry window with no signal.
// ⚠ 60s IS DELIBERATELY SLOW. The push path is the normal one and is near-instant; polling this
// degraded one faster would spend steady-state request budget on an already-broken case.
// `unref`'d, so it never holds a quit open.
const POLL_MS = 60000;

// The local dedupe ledger. ⚠ BOUNDED, oldest evicted first by insertion order — the idiom
// `session-windowless.js › MAX_NOTIFIED_DENIALS` and `trigger-outcomes.js › MAX_REMEMBERED_ENDS`
// use. An unbounded Set keyed by a server-minted id leaks for the life of the process, and an
// eviction costs at worst one extra CAS the server refuses.
const MAX_REMEMBERED = 256;

let armed = false;
let deps = { getUserId: null, launch: null, watchedChannel: null, workspaces: null };
let pollTimer = null;
const decided = new Set(); // directive ids this process has already acted on
const inflight = new Set(); // …and the ones it is acting on right now

function remember(id) {
  if (decided.size >= MAX_REMEMBERED) decided.delete(decided.values().next().value);
  decided.add(id);
}

/**
 * THE STANDING CONSENT **FOR THE LAUNCH KIND**, read at DECISION TIME and never cached. The
 * operator may turn the lane off while a directive is in flight, and the next one must see that
 * immediately.
 *
 * ⚠ **IT GATES `kind = 'launch'` AND NOTHING ELSE SINCE 2026-09-01** (Samuel's external
 * end/rename ruling). It used to gate the whole watcher, which was correct while the mailbox
 * carried one verb. It now carries three, and the other two are a STOP verb and a DISPLAY verb
 * that widen nothing — `directive-agent-ops.js`'s header carries the argument in full, including
 * why gating them here would leave an operator able to have agents started for them and unable
 * to stop them from where their orchestrator lives.
 * ⚠ **THE TOGGLE-OFF PATH IS THEREFORE NO LONGER "THE WATCHER IS ASLEEP".** `refresh` binds
 * realtime whenever the watcher is armed, so an unarmed-for-launch machine still SEES directives
 * and still answers `no-bridge` to a launch. That is a widening of what this process READS (its
 * own operator's own rows, over an authenticated subscription it already holds for
 * `channel_messages`) and of nothing it DOES: `handle` refuses every launch just as before.
 */
function launchEnabled() {
  try { return channelPrefs.getOrchestratorLaunch() === true; } catch (_err) { return false; }
}

// ⚠ **THE TWO AUTHENTICATED CALLS MOVED TO `main/launch-directive-calls.js` ON 2026-08-31**, at
// the §1 cap and on a real seam: they change when the SERVER's contract moves (the routes, the
// claim envelope, which status means "another machine won"), where everything left in this file
// changes when the LOCAL policy does. `post` is no longer re-exported — it had no caller outside
// the two verbs built on it, and re-exporting a raw POST from the module that owns the §6 argument
// would be handing the next reader a door beside the gate.
const calls = require('./launch-directive-calls');
const { claim, decide } = calls;

// ── The launch ───────────────────────────────────────────────────────────────────────────

/**
 * SPAWN, THROUGH THE ORDINARY FUNNEL. Returns `{ agentId }` or `{ refused: <word> }`.
 *
 * ⚠ EVERY CONTAINMENT INPUT COMES FROM THIS MACHINE, NOT FROM THE DIRECTIVE. Stated field by
 * field because this is the whole safety argument:
 *   toolProfile   `channel-listener.js › watchedChannel` — MAIN's own full server DTO off the
 *                 loop entry, the same read `sessions:launch` makes (F-267 fixed it to this) and
 *                 the same one `trigger.js` makes on the responder lane. Unwatched -> refuse.
 *   startModes    the operator's DURABLE per-channel posture, through
 *                 `channel-prefs.js › launchStartModes` — both axes, message axis floored at
 *                 `auto_inbound` for the windowless reason.
 *   windowless    literal `true`. There is one spawn shape.
 * The directive supplies `goal`, `model` and a TEMPLATE ID. None reaches a permission decision.
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
async function spawn(d) {
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
    // ⚠ `resolved.reason` IS ALREADY ONE OF THE WIRE WORDS — `no-template` for a 404 (deleted, invisible to THIS
    // operator, or IN ANOTHER TENANCY: `d.workspaceId` is the CHANNEL's container, so a template this operator
    // owns elsewhere is ABSENT from that read, not hidden), `busy` for a timeout/network/5xx. Passed through,
    // not re-mapped: `decideBody › refusalFor` is the closed-vocabulary gate — which is also why the T35 tenancy
    // note `template-resolve.js` logs cannot travel (`channel-ops-launch.ts › REFUSAL_SENTENCES` gives the RULE).
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
    },
    toolProfile: targeting.resolveToolProfile(channel),
    mode: 'interactive',
    windowless: true,
    startModes: channelPrefs.launchStartModes(d.channelId),
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
    launchChain: channelPrefs.getAgentChain(d.channelId), idle: !d.goal, // ⚠ `launchChain` (2026-08-31, Samuel's agent-chaining ruling): THIS lane is the ONLY caller that passes it, read PER DIRECTIVE and never cached (the operator may flip the channel setting between two of them), so a session started here may launch further agents exactly when the room says so — every other lane passes nothing, reads false, and keeps the one-generation bound. ⚠ `idle`: docblock; `directiveFrom` trimmed the goal, so '' is the only spelling of "none"
    operatorArmed: true, // ⚠ both branches: FIX-4 reads it only for a shell, but it is true either way
  });
  if (res && res.agentId) return { agentId: res.agentId };
  return { refused: wire.refusalFor(res && res.skipped) };
}

/** The goal a directive with none falls back to — the same sentence the New Agent button
 *  composes, because a directive with no goal is asking for exactly that agent. */
function defaultGoal(channelLevel) {
  return channelLevel
    ? 'Stand by in this channel as my agent: watch the main room and answer what is addressed to you.'
    : 'Join this thread as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.';
}

// ── The one entry point every source funnels into ────────────────────────────────────────

/**
 * ⚠ SILENT ON EVERY REFUSAL THAT IS NOT A DECISION. Toggle off, not mine, already handled,
 * not pending — none of these writes to the server, and none of them logs per occurrence. The
 * row expires and the orchestrator reads that; this machine says nothing about a request it was
 * never entitled to answer.
 */
async function handle(raw, workspaceId) {
  if (!armed) return;
  const d = wire.directiveFrom(raw, workspaceId);
  if (!d || d.status !== wire.STATUS_PENDING) return;
  // ⚠ **THE CONSENT GATE IS PER-KIND SINCE 2026-09-01, AND IT IS THIS LINE.** A LAUNCH spends
  // this operator's compute on their hardware and stays behind the toggle, silently, exactly as
  // before — the row expires and the orchestrator reads that. An `end` / `rename` does not:
  // `directive-agent-ops.js`'s header carries the whole argument, and IT IS THE ASSUMPTION MOST
  // WORTH OVERRULING IF SAMUEL DISAGREES — reverting is deleting the `d.kind` test here.
  if (d.kind === wire.KIND_LAUNCH && !launchEnabled()) return;
  const me = (deps.getUserId && deps.getUserId()) || null;
  // ⚠ THE LOCAL OWNER RE-CHECK. The realtime filter is workspace-wide — see the header.
  if (!me || d.operatorUserId !== me) return;
  if (decided.has(d.id) || inflight.has(d.id)) return;
  inflight.add(d.id);
  try {
    const claimed = await claim(d);
    if (!claimed) { remember(d.id); return; } // lost the race, or the row is gone
    // ⚠ REMEMBERED THE MOMENT IT IS OURS, BEFORE THE SPAWN. `launch` awaits `getSdk()`, which is
    // wide enough for the backstop poll to deliver the same row again — and the second pass
    // would find the row `claimed` rather than `pending` and stop, but only if the server got
    // there first. This does not depend on that.
    remember(claimed.id);
    // ⚠ DISPATCH ON THE **CLAIMED** ROW'S KIND, NEVER THE FRAME'S. `claim` re-narrows from the
    // CAS's own answer, which is the authenticated one; if the two disagree, the granted row is
    // what this machine was actually given. Same rule the goal, the model and the template
    // already follow.
    // ⚠ EVERY BRANCH ANSWERS. A claimed directive nobody decides is the one outcome the
    // orchestrator cannot act on — see `apply`'s fallthrough.
    const outcome = claimed.kind === wire.KIND_LAUNCH
      ? await spawn(claimed)
      : require('./directive-agent-ops').apply(claimed);
    await decide(claimed, outcome);
  } catch (err) {
    diag('launch-directive: handler threw —', (err && err.message) || String(err));
    // ⚠ NO DECISION IS WRITTEN ON A THROW, DELIBERATELY. This machine does not know whether the
    // spawn happened, and `refused` would be a claim it cannot support; letting the row expire
    // is the honest answer and is what `sweep` reasons about on the next start.
  } finally {
    inflight.delete(d.id);
  }
}

/** The realtime lane's entry (`main/realtime.js › onDirective`). */
function deliver(workspaceId, row) {
  void handle(row, workspaceId);
}

// ── The breaker-open backstop ────────────────────────────────────────────────────────────

// ⚠ THE READ EXISTS — F-273 IS CLOSED (measured 2026-08-23). `ROUTES.pending` resolves to
// `src/app/api/channels/launch-directives/route.ts › handleGet`, an authed collection GET over
// `service-launch.ts › listPendingLaunchDirectives` answering `{ directives }` and fenced on
// `operator_user_id`. This is a working recovery path, not a stub.
// ⚠ THE 404 SELF-DISABLE STAYS, AND NOT AS A LEFTOVER: it is the OLDER-DEPLOYMENT degradation
// (INVARIANTS §13 — an older peer is supported). Such a server still 404s, and standing down
// after the first is still right — one dead request per run instead of one per minute, visible
// in `listener.log`. Against it realtime is the only path and a missed directive expires, which
// the orchestrator already handles (a closed laptop produces it too).
let pollUnavailable = false;

async function pollWorkspace(wsId) {
  try {
    const res = await apiFetch(wire.ROUTES.pending, {
      method: 'GET', workspaceId: wsId, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
    });
    if (res && res.status === 404 && !pollUnavailable) {
      pollUnavailable = true;
      // ⚠ NOT A FILED GAP — an OLDER SERVER. Worded as the deployment fact it is, so an operator
      // reading `listener.log` is not sent to a finding that closed on 2026-08-22.
      diag('launch-directives: this server has no pending-directives read (it predates it) —',
        'the backstop is disabled for this run; realtime is the only path, and a miss expires');
    }
    if (!res || !res.ok) return;
    const body = await res.json().catch(() => null);
    const rows = (body && (body.directives || body.rows)) || [];
    if (!Array.isArray(rows)) return;
    for (const row of rows) await handle(row, wsId);
  } catch (_err) { /* the backstop is best-effort by construction */ }
}

async function poll() {
  // ⚠ NO LONGER GATED ON THE LAUNCH TOGGLE (2026-09-01). The backstop's job is to deliver rows
  // the breaker made realtime miss, and two of the three kinds are answerable with the toggle
  // off — a poll that stood down would make the recovery path the one place an end silently
  // expires. `handle` still refuses every launch, per kind.
  if (!armed || pollUnavailable) return;
  const list = (deps.workspaces && deps.workspaces()) || [];
  for (const wsId of list) {
    // ⚠ ONLY WHILE PUSH IS DOWN FOR **THIS** WORKSPACE. A healthy sub already delivers these,
    // and polling beside it would double every claim attempt for no benefit.
    if (realtime.isWorkspaceHealthy(wsId)) continue;
    await pollWorkspace(wsId);
  }
}

// ── Arming ───────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ CRASH SAFETY — A CLAIMED-BUT-UNDECIDED DIRECTIVE IS LEFT TO LAZY-EXPIRE. THE CHOICE, STATED.
 *
 * The alternative was to re-read claimed rows on start and decide them. REJECTED, because this
 * process cannot tell the two cases apart: a directive claimed at 09:00:01 and crashed at
 * 09:00:02 may have spawned an agent that died with the process, or may have spawned nothing.
 * `refused` would be a claim this machine cannot support and `launched` would name an agent that
 * does not exist. **An expiry is the only honest terminal state for an outcome nobody observed**,
 * and the orchestrator already handles expiry — it is the toggle-off path's normal answer.
 * ⚠ AND IT COSTS NOTHING TO SAFETY. A claimed row is not `pending`, so no machine re-actions it;
 * the worst case is one orchestrator request that times out instead of being refused promptly.
 * ⚠ WHAT WOULD CHANGE THE ANSWER: a directive carrying the agent id it expected, or a session
 * record durable enough to answer "did this spawn survive". Neither exists, and inventing one for
 * this is a bigger change than the lane.
 */
function start(opts) {
  const o = opts || {};
  deps = {
    getUserId: typeof o.getUserId === 'function' ? o.getUserId : null,
    launch: typeof o.launch === 'function' ? o.launch : null,
    watchedChannel: typeof o.watchedChannel === 'function' ? o.watchedChannel : null,
    workspaces: typeof o.workspaces === 'function' ? o.workspaces : null,
  };
  if (!deps.launch || !deps.getUserId) {
    diag('launch-directives: NOT armed — no launch funnel or no identity');
    return;
  }
  armed = true;
  refresh();
  if (!pollTimer) {
    pollTimer = setInterval(() => { void poll(); }, POLL_MS);
    if (typeof pollTimer.unref === 'function') pollTimer.unref();
  }
  diag('launch-directives: armed — LAUNCH lane',
    launchEnabled() ? 'ENABLED by this operator' : 'off (default; end/rename still answer)');
}

/**
 * Re-read the toggle and tell realtime what to bind. ⚠ CALLED AFTER EVERY FLIP, because the
 * binding is decided at JOIN time and cannot be added to a live channel — `realtime.js ›
 * setDirectives` rejoins for exactly that reason. Idempotent, so a caller may assert its intent
 * whenever it likes.
 */
function refresh() {
  // ⚠ **BOUND WHENEVER ARMED, NOT WHENEVER THE LAUNCH TOGGLE IS ON (2026-09-01).** It read
  // `armed && enabled()` while the mailbox carried one verb, and that was the same condition.
  // It is not any more: with the toggle off this machine must still SEE `end` / `rename` rows,
  // or the two verbs that need no consent would be reachable only on machines that had granted
  // the consent they do not need — the exact inversion the ruling exists to remove.
  // ⚠ WHAT THIS WIDENS IS A **READ**, AND ONLY OF THIS OPERATOR'S OWN ROWS: one more
  // `postgres_changes` binding on a subscription this process already holds for
  // `channel_messages`, filtered to a workspace it is already signed into, over rows whose RLS
  // SELECT is `operator_user_id = auth.uid()`. It widens nothing this machine DOES — `handle`
  // refuses every launch exactly as before.
  try { realtime.setDirectives(armed, deliver); }
  catch (err) { diag('launch-directives: realtime arm failed —', err && err.message); }
}

function stop() {
  armed = false;
  pollUnavailable = false; // a new run may reach a newer server
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  decided.clear();
  inflight.clear();
  try { realtime.setDirectives(false, null); } catch (_err) { /* already down */ }
}

module.exports = {
  start,
  stop,
  refresh, // the toggle moved: rebind realtime
  deliver, // main/realtime.js's handler
  handle, // the one funnel — exported for the suite
  POLL_MS,
  MAX_REMEMBERED,
};

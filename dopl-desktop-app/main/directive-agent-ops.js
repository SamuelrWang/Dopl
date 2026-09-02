// THE AGENT-MANAGEMENT DIRECTIVE KINDS — what this machine DOES when an external
// agent of this operator's asks it to END or RENAME one of its running agents
// (2026-09-01, Samuel: "yeah I need you to build out dopl mcp being able to end
// agents. Dopl MCP need to be able to do all that stuff").
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────────
//
// `end_agent` / `rename_agent` already existed — INSIDE a desktop-spawned session,
// as the in-process `dopl_agents` MCP server (`agent-self-ops.js`, mounted by
// `runtime/claude/axis-b.js › makeAgentOpsServer`). What did not exist was any way
// for an EXTERNAL session — the Claude Desktop / Claude Code process holding this
// operator's own Dopl credential — to reach them, because no server can reach a
// desktop main process. The launch mailbox is the ONE mechanism that crosses that
// gap, so the verbs became KINDS of `channel_launch_directives` row and this
// module is the branch `launch-directives.js › handle` dispatches to.
//
// ⚠ **IT IMPLEMENTS NEITHER VERB. IT ROUTES TO THE EXISTING ONE.** That is the
// whole design constraint and it is worth stating flatly, because a second stop
// path is a second set of teardown bugs (`session-reopen.js › controlByTask` says
// the same about the Agents tab):
//   end    -> `agent-self-ops.js › endVerdict` for the verdict table, then
//             `session-engine.js › controlByTask({action:'end'})` — the SAME two
//             calls `axis-b.js`'s in-process `end_agent` makes, in the same order.
//             That bottoms out in the reducer's `{type:'end'}` event, which is
//             also what `sessions:end` and `sessions:delete` dispatch.
//   rename -> `agent-self-ops.js › applyRenameTo`, the ONE rename write, shared
//             with `sessions:rename` and with the in-process tool. Display-only,
//             sanitizer-bounded, local `electron-store`, no network.
// **If either verb needs to change, it changes THERE and this file follows for
// free. Nothing here may grow a second opinion about what an end is.**
//
// ── ⚠ THE CONSENT GATE: THERE ISN'T ONE, AND THAT IS A RULING ────────────────
//
// `launch-directives.js` is OFF unless `channel-prefs.js › getOrchestratorLaunch`
// is true, per machine — "THE TOGGLE IS THE CONSENT" (Samuel, 2026-08-22;
// INVARIANTS §6/§11). **These two kinds are NOT behind it.**
//
// The argument is `agent-self-ops.js`'s own, applied to the same two verbs on the
// same subjects, and it is the argument that already licensed those verbs to ride
// PRE-APPROVED past the Axis-A gate inside every spawned session:
//   • **END is a STOP VERB that widens nothing.** It cannot start a query, wake a
//     parked shell, grant a tool or post. The failure direction of an abused call
//     is an agent that STOPS — on the machine of the operator whose agents they
//     all are, at the request of a session holding that same operator's own
//     credential.
//   • **RENAME is DISPLAY ONLY, on this machine.** `agent-names.js` holds it in a
//     local store, nothing resolves an agent by it, no server ever sees it, and no
//     other member can observe it. A rename cannot re-point a running instruction.
// The toggle exists to gate LOCAL COMPUTE BEING SPENT — a directive that starts a
// process this operator pays for, on hardware they own. Neither of these spends
// any, so gating them on it would be a fence that buys nothing and costs the
// feature: an operator who has not armed launch-over-MCP would be able to have
// agents started for them by the button and then be unable to stop them from the
// same place their orchestrator lives.
//
// ⚠ **THIS IS THE ASSUMPTION MOST WORTH OVERRULING IF SAMUEL DISAGREES, AND IT IS
// ONE `if` IN `launch-directives.js › handle`.** Recorded here rather than buried:
// making these kinds respect the toggle is a two-line change, and this paragraph
// is what a future reader needs in order to make it deliberately.
//
// ⚠ **THE OWN-OPERATOR BOUND IS FREE HERE, NOT ENFORCED** — the same sentence
// `session-ipc-ops.js` writes over `sessions:end` and `agent-self-ops.js` writes
// over both its verbs. `handle` has already re-checked `operatorUserId` against
// the signed-in identity, and the registry holds only sessions THIS machine runs
// for THIS operator, so there is no cross-member agent to reach and nothing to
// refuse. A peer's agent is a handle in a channel read, never a row either verb
// can resolve. (The SERVER refuses a demonstrably foreign target earlier, so the
// caller gets a sentence instead of a two-minute round trip — but that is an error
// message, not the fence.)
//
// ⚠ **SELF-END DOES NOT ARISE ON THIS LANE, WHICH IS WHY IT IS NOT REFUSED HERE.**
// `agent-self-ops.js` refuses it because the dispatch would abort the CALLING
// turn mid-tool-call, so the result could never be delivered and the call would
// read as a hang. The caller here is an EXTERNAL session — not a desktop agent,
// holding no instance id, and not in the middle of a turn this process runs — so
// there is no self to end. `endVerdict` is still handed `''` as the caller id,
// which makes its `self` branch unreachable rather than absent: the verdict table
// stays the one table, and a future in-process caller of THIS module would get the
// refusal for free.

const { diag } = require('./diag');
const agentOps = require('./agent-self-ops');
const wire = require('./launch-directive-wire');
// ⚠ THE POSTURE BOUND IS SHARED WITH THE LAUNCH BRANCH (2026-09-01, T24) — one statement of
// "an orchestrator may ask, and it may never widen", required rather than copied. Two lanes
// reading one rule; `main/launch-posture.js`'s header carries the argument.
const posture = require('./launch-posture');

/**
 * END THE AGENT A DIRECTIVE NAMES. Returns `{ done: true }` or
 * `{ refused: <wire word> }`.
 *
 * ⚠ THE VERDICT TABLE IS `agent-self-ops.js › endVerdict`, UNCHANGED AND UNCOPIED
 * — pure over (caller id, requested id, the registry projection), so the whole
 * table is testable without a session and both callers get the same answers.
 * `''` as the caller id is deliberate; see this file's header on self-end.
 *
 * ⚠ **`no-session` IS THE ORDINARY ANSWER AND IS NOT AN ERROR.** An agent that
 * finished is the commonest cause, and for an END that is the outcome the
 * requester wanted, reached without them. It is logged at the same level as a
 * success and the MCP render says so in as many words.
 *
 * ⚠ A `bad-agent-id` VERDICT MAPS TO `no-session` RATHER THAN MINTING A TENTH
 * WIRE WORD. It is unreachable from a real directive — the create schema and the
 * column CHECK both require the anchored 8-character shape, and
 * `directiveFrom` empties anything else — so a word for it would be a refusal
 * nothing can produce, and the vocabulary is CLOSED on the wire for exactly that
 * reason. "There is no such agent here" is also true of a malformed id.
 */
function endAgent(d) {
  let rows = [];
  try {
    const engine = require('./session-engine');
    rows = typeof engine.listLiveSessions === 'function' ? engine.listLiveSessions() : [];
  } catch (_err) { rows = []; }

  const v = agentOps.endVerdict('', d.targetAgentId, rows);
  if (!v.ok) {
    diag('directive-agent-ops: end', String(d.targetAgentId || '(none)'),
      '— no live session (' + String(v.reason) + '), which is usually an agent that already finished');
    return { refused: 'no-session' };
  }

  let res = { ok: false };
  try {
    // ⚠ THE SAME DISPATCH `sessions:end`, `sessions:delete` and the in-process
    // `end_agent` all make. The address comes from the RESOLVED REGISTRY ROW, not
    // from the directive: the row is what the engine will match on, and re-deriving
    // a session key from wire fields is how the two come to disagree about which
    // session a request names.
    res = require('./session-engine').controlByTask({
      channelId: String(v.row.channelId || ''),
      taskId: String(v.row.taskId || ''),
      agentId: String(v.row.agentId || ''),
      action: 'end',
    }) || { ok: false };
  } catch (_err) { res = { ok: false }; }

  if (!res.ok) {
    // ⚠ THE SESSION SETTLED BETWEEN THE LOOKUP AND THE DISPATCH — the one race
    // this path has, and `no-session` is the honest word for it: whatever the
    // requester wanted stopped is not running now.
    diag('directive-agent-ops: end', String(v.row.agentId || ''),
      'REFUSED by the engine (' + String(res.reason || 'no-session') + ') — it settled mid-flight');
    return { refused: 'no-session' };
  }
  diag('directive-agent-ops: end', String(v.row.agentId || ''), 'ok');
  return { done: true };
}

/**
 * RENAME THE AGENT A DIRECTIVE NAMES. Returns `{ done: true }` or
 * `{ refused: <wire word> }`.
 *
 * ⚠ **IT DOES NOT REQUIRE A LIVE SESSION, AND THAT IS NOT AN OVERSIGHT.**
 * `agent-names.js` is keyed by the INSTANCE ADDRESS and outlives the session
 * object on purpose — the operator's mental model ("the one I called Research")
 * survives an idle park, a lazy resume and a crash resume, and so does the id.
 * `sessions:rename` consults no registry either, and this must not either, or a
 * name would become un-settable at exactly the moments a session is being rebuilt.
 *
 * ⚠ THE TARGET IS THE DIRECTIVE'S, NEVER A DEFAULT. `agent-self-ops.js ›
 * renameTargetFor` has a SELF fallback for the in-process tool ("name yourself
 * after your role"); there is no self here, so a directive that carried no usable
 * target is refused rather than defaulted — an unaddressed rename that guessed
 * would label an agent nobody asked about, silently.
 *
 * ⚠ `bad-name` IS THE SANITIZER'S WORD, and it is a REFUSAL rather than a strip:
 * `sanitizeName` rejects control, zero-width and bidi characters instead of
 * removing them, because storing a silently altered name is worse than not taking
 * it. `''` is not a bad name — it CLEARS.
 */
function renameAgent(d) {
  if (!d.targetAgentId) {
    diag('directive-agent-ops: rename — directive carried no usable agent id');
    return { refused: 'no-session' };
  }
  if (typeof d.targetName !== 'string') {
    // ⚠ Unreachable from a real directive (the column CHECK requires a non-null
    // `target_name` on `kind='rename'`), and refused rather than treated as a
    // CLEAR: `null` means "this is not a rename", and acting on it would wipe a
    // name nobody asked to wipe.
    diag('directive-agent-ops: rename', d.targetAgentId, '— directive carried no name at all');
    return { refused: 'bad-name' };
  }
  let res = { ok: false, reason: 'bad-name' };
  try {
    // ⚠ THE ONE RENAME WRITE, shared with `sessions:rename` and the in-process
    // tool. Lazy require: `agent-names.js` opens an electron-store the moment it
    // is loaded, and this module is required at watcher arm time.
    res = agentOps.applyRenameTo(require('./agent-names'), d.targetAgentId, d.targetName);
  } catch (err) {
    diag('directive-agent-ops: rename', d.targetAgentId, '— store write threw:',
      (err && err.message) || String(err));
    return { refused: 'busy' };
  }
  if (!res.ok) {
    diag('directive-agent-ops: rename', d.targetAgentId, 'REFUSED by the sanitizer');
    return { refused: 'bad-name' };
  }
  diag('directive-agent-ops: rename', d.targetAgentId,
    res.name === null ? 'cleared' : 'set to "' + res.name + '"');
  return { done: true };
}


/**
 * MOVE A RUNNING AGENT'S TWO PERMISSION AXES. Returns `{ done: true }` or
 * `{ refused: <wire word> }`.
 *
 * ⚠ **IT IMPLEMENTS NOTHING, EXACTLY LIKE THE TWO VERBS ABOVE.** The live-apply op is
 * `session-engine.js › setModeByTask` — the reducer's own `set_tool_mode` /
 * `set_message_mode`, where the windowless MESSAGE floor (F-236) and the fail-closed
 * coercion already live — and it is the same op `sessions:setMode` and
 * `channel-dir-ipc.js › applyPostureToLive` call. A second writer to those two fields
 * is how two readers come to disagree about one posture.
 *
 * ⚠ **IT WIDENS SUPERVISION, NEVER CONTAINMENT**, and that is not a claim this file
 * has to make good on: the tool PROFILE is resolved at spawn from this machine's own
 * watched-channel DTO, `SESSION_HARD_DENY` is unconditional, and `bypass` is a
 * POSITIVE allow-list — so no posture reaching `setModeByTask` can widen what an agent
 * may touch. `applyPostureToLive`'s header makes the identical argument for the
 * operator's own Settings tab, which is the surface this lane mirrors.
 *
 * ⚠ **PER AGENT, NEVER PER THREAD.** The directive names ONE `target_agent_id`; passing
 * only (channel, thread) would take the oldest agent on the thread and silently skip
 * its siblings, which under multiplayer is most of the room.
 *
 * ⚠ **BOTH AXES OPTIONAL, AND BOTH EMPTY IS A REFUSAL.** A directive may move one axis
 * and leave the other; one that names neither (or names only values this build does not
 * recognise — `directiveFrom` empties those) asked for nothing this machine can do, and
 * `no-bridge` is the honest word for it in the closed vocabulary: "this machine could
 * not take it". Reporting `done` for a no-op would tell an orchestrator its posture
 * landed when nothing moved.
 */
function setAgentMode(d) {
  if (!d.targetAgentId) {
    diag('directive-agent-ops: set_agent_mode — directive carried no usable agent id');
    return { refused: 'no-session' };
  }
  if (!d.targetToolMode && !d.targetMessageMode) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId,
      '— no axis this build recognises; nothing applied');
    return { refused: 'no-bridge' };
  }

  // ⚠ THE CEILING IS READ AT DECISION TIME AND NEVER CACHED, exactly as the consent
  // toggle is: the operator may narrow their channel posture while a directive is in
  // flight, and the next one must see it immediately. `getLaunchPosture` never answers
  // null — an unset or unreadable record IS the restrictive default — so a store failure
  // narrows rather than opens.
  let ceiling = { tools: 'manual', messages: 'ask' };
  try {
    ceiling = require('./channel-prefs').getLaunchPosture(d.channelId) || ceiling;
  } catch (err) {
    diag('directive-agent-ops: set_agent_mode — posture ceiling unreadable, using the floor:',
      (err && err.message) || String(err));
  }
  const tools = posture.narrowTo(d.targetToolMode, ceiling.tools, wire.TOOL_MODES);
  const messages = posture.narrowTo(d.targetMessageMode, ceiling.messages, wire.MESSAGE_MODES);
  if (tools !== d.targetToolMode || messages !== d.targetMessageMode) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId, 'CLAMPED to the channel posture —',
      'asked', String(d.targetToolMode || '-') + '/' + String(d.targetMessageMode || '-'),
      'ceiling', ceiling.tools + '/' + ceiling.messages);
  }

  let rows = [];
  try {
    const engine = require('./session-engine');
    rows = typeof engine.listLiveSessions === 'function' ? engine.listLiveSessions() : [];
  } catch (_err) { rows = []; }
  const row = rows.find((r) => r && String(r.agentId || '') === d.targetAgentId) || null;
  if (!row) {
    // ⚠ THE ORDINARY ANSWER, AND NOT AN ERROR — the same sentence `endAgent` writes. A
    // posture is a property of a RUNNING session (it lives on `s.state`), so there is
    // nothing to move on an agent that has finished and no durable record to move it in.
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId, '— no live session');
    return { refused: 'no-session' };
  }

  let applied = 0;
  try {
    const engine = require('./session-engine');
    // ⚠ THE ADDRESS COMES FROM THE RESOLVED REGISTRY ROW, NOT FROM THE DIRECTIVE — the
    // same rule `endAgent` follows: the row is what the engine matches on, and re-deriving
    // a session key from wire fields is how the two come to disagree about which session a
    // request names.
    const target = {
      channelId: String(row.channelId || ''),
      taskId: String(row.taskId || ''),
      agentId: String(row.agentId || ''),
    };
    if (tools) {
      const r = engine.setModeByTask(Object.assign({ axis: 'tools', mode: tools }, target));
      if (r && r.ok) applied += 1;
    }
    if (messages) {
      const r = engine.setModeByTask(Object.assign({ axis: 'messages', mode: messages }, target));
      if (r && r.ok) applied += 1;
    }
  } catch (err) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId, '— engine threw:',
      (err && err.message) || String(err));
    return { refused: 'busy' };
  }
  if (!applied) {
    // The one race this path has: the session settled between the lookup and the dispatch.
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId,
      'REFUSED by the engine — it settled mid-flight');
    return { refused: 'no-session' };
  }
  diag('directive-agent-ops: set_agent_mode', d.targetAgentId, 'ok —',
    (tools || '-') + '/' + (messages || '-'));
  // ⚠ THE ECHO, ON THIS LANE TOO (2026-09-02). It returned a bare `{ done: true }`, so a
  // request CLAMPED to the channel's ceiling was answered `taken` with the clamp visible only
  // in this machine's own log — the exact defect T24's echo closed on the LAUNCH lane, left
  // open on the one lane whose entire purpose is moving a posture. An orchestrator told
  // `taken` sizes its next instruction for the room it asked for.
  // ⚠ ONLY WHAT WAS REALLY APPLIED. An axis the directive left alone stays ABSENT, which the
  // server stores as NULL and `channel-ops-launch.ts › postureFacts` renders as `-`; echoing
  // the ceiling for an axis nobody asked about would report a move that did not happen.
  // ⚠ NO `appliedChain` — a re-posture starts nothing, so it decides no chaining, and a
  // `false` here would be a claim about a session's spawn-time stamp this lane never touched.
  const out = { done: true };
  if (tools) out.appliedTools = tools;
  if (messages) out.appliedMessages = messages;
  return out;
}

/**
 * THE ONE ENTRY POINT — dispatch a NON-LAUNCH directive.
 *
 * ⚠ **AN UNKNOWN KIND CANNOT ARRIVE AND IS STILL ANSWERED.**
 * `launch-directive-wire.js › directiveFrom` collapses anything it does not
 * recognise to `launch`, which never reaches this function, and the caller only
 * routes `end` / `rename` here. The fallthrough exists because this row has been
 * CLAIMED: a claimed directive that is never decided is the one outcome the
 * requester cannot act on, so every path out of here writes a verdict.
 */
function apply(d) {
  if (d.kind === wire.KIND_END) return endAgent(d);
  if (d.kind === wire.KIND_RENAME) return renameAgent(d);
  if (d.kind === wire.KIND_SET_MODE) return setAgentMode(d);
  diag('directive-agent-ops: unknown kind', String(d.kind || '(none)'), '— refusing rather than leaving it undecided');
  return { refused: 'no-bridge' };
}

module.exports = { apply, endAgent, renameAgent, setAgentMode };

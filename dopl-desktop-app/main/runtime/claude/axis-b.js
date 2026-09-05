// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — the held permission callback, and the in-process
// tool server that rides beside it.
//
// ⚠ WHY THIS IS A FIRST-CLASS DESCRIPTOR FIELD AND NOT AN ASSUMPTION. Axis B — whether a message
// crosses between machines — is DOPL'S plane, but it has no enforcement point of its own:
//   1. The Dopl MCP server is REMOTE HTTP (`loader.js › buildMcpServers` returns
//      `{ dopl: { type: 'http', … } }`). The desktop main process is NOT in the call path of a
//      channel call.
//   2. The only thing between the model and that endpoint is the HELD CALLBACK below, which the
//      launch spec wires and then pins the platform's own permission mode to `default`
//      precisely so the platform cannot short-circuit it.
//   3. The SERVER CANNOT BE THE BACKSTOP: no posture field ever crosses the wire, so
//      `packages/mcp-server` does not know what Axis B is set to and could not refuse the post.
// So: Axis B needs an in-process tool boundary OR a held callback. Where neither exists there is
// no outbound gate, and a missing outbound gate is not a hidden capability — it is the gate
// coming off. `descriptor.axisB.enforcementPoint` is where a runtime says which one it has, and
// `null` refuses registration (`main/runtime/contract.js › LAUNCH_BLOCKING`).
//
// ⚠ THIS RUNTIME'S ANSWER IS `held-callback`, AND IT IS OP-SCOPED. The callback sees the tool
// INPUT, so the gate can read `input.op` / `input.channel` / `to` / `kind` and scope a standing
// grant to the exact shape the operator was shown. A runtime whose approval request carries no
// arguments collapses Axis B from op-scoped to WHOLE-TOOL — every channel call gates, READS
// INCLUDED — and a held inbound on a windowless session is then held forever, which is precisely
// what `session-profiles.js › floorWindowlessMessage` exists to prevent.
//
// ⚠ `axisBTools()` IS NULL HERE, AND THE AGENT-OPS SERVER BELOW IS NOT A COUNTEREXAMPLE. That
// server is the same MECHANISM an in-process Axis B would use — a tool this process IMPLEMENTS
// rather than proxies — with the opposite discipline: its two verbs ride the pre-approval list
// and are therefore SHADOWED PAST THE GATE ENTIRELY. That is defensible for a display verb and a
// stop verb (see `main/agent-self-ops.js`'s header for the whole argument) and would be
// indefensible for a channel op, which is the call that has to gate. A runtime that implements
// its channel ops in-process must NOT inherit this shadow: every implementation calls
// `grantDecision` before it acts. Stated here rather than left to be rediscovered.

// ⚠ THE BRIDGE IS LAZY, AND THAT IS A LOAD-ORDER CONTRACT, NOT A STYLE. `session-gate-bridge.js`
// reads `session-profiles.js`, which asks `main/runtime/index.js` for every gate decision — so a
// top-level require here would close the loop and hand the gate a half-initialised module whose
// exports are `undefined` at exactly the moment it asks for a deny list.
const bridge = () => require('../../session-gate-bridge');
const approval = require('./approval');
const agentOps = require('../../agent-self-ops');

/**
 * The held permission callback this runtime's launch spec wires.
 *
 * Pre-approved reads are shadowed by the platform's own allow-list and never reach here; what
 * DOES reach here is the live-gated work tools plus the channel tool. `log` is injected (the
 * engine passes its diag) so nothing on this path reaches electron.
 */
function makeCanUseTool(s, dispatch, log) {
  return function canUseTool(name, input, opts) {
    const decision = bridge().gateCall(s, name, input, opts, dispatch, log);
    if (decision.settled) {
      return Promise.resolve(approval.answerApproval(
        { tag: decision.tag, message: decision.message }, decision.verdict
      ));
    }
    // ⚠ THE PROMISE IS THE MECHANISM, NOT A DETAIL: the platform BLOCKS THE TURN on it, which is
    // what makes `gate` a real verdict rather than a pre-flight list. `park` hands the bridge
    // this resolver, wrapped so the forced thread tag rides an operator ALLOW and nothing else.
    return new Promise((resolve) => decision.park(resolve));
  };
}

/**
 * In-process Axis-B tool implementations, or `null`.
 *
 * ⚠ NULL ON THIS RUNTIME BY DECLARATION, NOT BY OMISSION: Axis B is enforced by the held callback
 * above, so there is nothing to implement in-process. See the header for why the agent-ops server
 * is not this.
 */
function axisBTools(_session) {
  return null;
}

// ── THE IN-PROCESS AGENT-OPS SERVER ──────────────────────────────────────────────────────────
//
// ⚠ MOVED HERE FROM `main/agent-self-ops.js` ON 2026-08-31 (runtime-adapter port, step 3). Its
// PURE half — the rename target rule, the end verdict table, the two result shapes — stayed in
// core, because none of it is platform-shaped; what moved is the part built with THIS runtime's
// own MCP-server helpers off a cached SDK namespace. The ruling, the own-agents bound, the
// shadow argument and the self-end refusal all live in that module's header and are not
// re-argued here.
//
// ⚠ A NULL SERVER MUST NEVER BREAK A LAUNCH. Null whenever the SDK namespace is not yet cached
// or zod is unresolvable (a harness): the session then runs without the two verbs, which is the
// pre-ruling behaviour, not an error.

// The rename write, shared by the tool handler below. Split out so the handler stays a
// routing shape; answers a CallToolResult either way. ⚠ THE ANSWER IS MAIN'S OWN STORED
// VALUE, never an echo — `sessions:rename`'s rule, kept here for the same reason.
function applyRename(target, value) {
  // ⚠ THE WRITE ITSELF MOVED TO `agent-self-ops.js › applyRenameTo` ON 2026-09-01,
  // when the external `rename_agent` DIRECTIVE became its third caller. What
  // stayed here is the SENTENCE — the split every wire value on this lane takes,
  // and for the same reason: prose belongs to the reader, and a rule shared by
  // three surfaces belongs to one function.
  // ⚠ AND IT COMMITS THROUGH `agent-identity-commit.js` SINCE 2026-09-05, which writes the store
  // AND flushes the summary — the flush is what carries the new name to the server and so to
  // every other member's @-picker. All THREE rename paths had the same missing flush; fixing only
  // the one Samuel happened to use would have left the other two broken in a way nobody would
  // notice for weeks. That module's header carries the argument, and the lazy require (the store
  // opens an electron-store) moved in there with the write.
  const res = require('../../agent-identity-commit').commitRename(target, value);
  if (!res.ok) {
    return agentOps.refuse('Name refused: 1-60 visible characters on one line; control, zero-width and bidi characters are rejected, not stripped.');
  }
  if (res.name === null) {
    return agentOps.txt('Display name for agent ' + target + ' cleared — it reads as "Agent #' + target + '" again.');
  }
  return agentOps.txt('Display name for agent ' + target + ' is now "' + res.name + '". Display only — @agent-' + target + ' is unchanged and remains the only address.');
}

// Build THIS session's server instance. `s` is the engine's session object; only `agentId`
// is read, at call time, so a park/resume that replaces the object mid-life still answers
// for the id the operator knows.
function makeAgentOpsServer(s) {
  let sdk = null;
  try { sdk = require('./loader').peekSdk(); } catch (_) { sdk = null; }
  if (!sdk || typeof sdk.createSdkMcpServer !== 'function' || typeof sdk.tool !== 'function') return null;
  let z = null;
  try { z = require('zod').z; } catch (_) { z = null; }
  if (!z) return null;
  const diag = require('../../diag').diag;
  const selfId = function () { return String((s && s.agentId) || ''); };

  const rename = sdk.tool(
    'rename_agent',
    'Set the display name of one of your operator\'s agents on this machine — yourself by default. ' +
    'Use it to label agents by role (e.g. "Research", "Verifier"). Display only: the @agent-<id> ' +
    'handle is unchanged and remains the only address. An empty name clears back to "Agent #<id>". ' +
    'Own-operator agents only; a peer\'s agents are not reachable from this machine at all.',
    {
      name: z.string().max(200).describe('The display name (1-60 visible chars; empty string clears). One line.'),
      agent_id: z.string().max(40).optional().describe('Which agent to rename — an 8-char instance id (bare or @agent- prefixed). Omit for yourself.'),
    },
    async function (args) {
      const target = agentOps.renameTargetFor(selfId(), args && args.agent_id);
      if (!target.ok) {
        return agentOps.refuse(target.reason === 'no-self'
          ? 'Refused: no agent_id passed and this session carries no agent id of its own.'
          : 'Refused: "' + String(args && args.agent_id) + '" is not an agent instance id (8 chars, as read_sessions prints them).');
      }
      const out = applyRename(target.agentId, args && args.name);
      diag('agent-self-ops: rename', target.agentId, 'by', selfId(), out.isError ? '(refused)' : 'ok');
      return out;
    },
    { alwaysLoad: true, annotations: { readOnlyHint: false, destructiveHint: false } }
  );

  const end = sdk.tool(
    'end_agent',
    'End ANOTHER of your operator\'s agents on this machine (e.g. a worker that is done or stuck). ' +
    'Terminal for that agent\'s session; it touches no thread and deletes no message. You cannot end ' +
    'yourself — when you are finished, simply stop. Own-operator agents only.',
    {
      agent_id: z.string().max(40).describe('The agent to end — an 8-char instance id (bare or @agent- prefixed), as read_sessions prints them.'),
    },
    async function (args) {
      let rows = [];
      try {
        const engine = require('../../session-engine');
        rows = typeof engine.listLiveSessions === 'function' ? engine.listLiveSessions() : [];
      } catch (_) { rows = []; }
      const v = agentOps.endVerdict(selfId(), args && args.agent_id, rows);
      if (!v.ok) {
        if (v.reason === 'self') return agentOps.refuse('Refused: you cannot end yourself — ending this session would abort the very turn making this call. When you are done, stop.');
        if (v.reason === 'no-session') return agentOps.refuse('No live session of your operator\'s carries that agent id. It may already be ended — read_sessions shows the live set.');
        return agentOps.refuse('Refused: "' + String(args && args.agent_id) + '" is not an agent instance id (8 chars, as read_sessions prints them).');
      }
      let res = { ok: false };
      try {
        res = require('../../session-engine').controlByTask({
          channelId: String(v.row.channelId || ''),
          taskId: String(v.row.taskId || ''),
          agentId: String(v.row.agentId || ''),
          action: 'end',
        }) || { ok: false };
      } catch (_) { res = { ok: false }; }
      diag('agent-self-ops: end', String(v.row.agentId || ''), 'by', selfId(), res.ok ? 'ok' : 'REFUSED');
      if (!res.ok) return agentOps.refuse('End refused by the engine (' + String(res.reason || 'no-session') + ') — the session may have settled between the lookup and the dispatch.');
      return agentOps.txt('Agent ' + String(v.row.agentId || '') + ' ended. Terminal for that session; the thread it worked (if any) is untouched and everything it posted stays in the channel.');
    },
    { alwaysLoad: true, annotations: { readOnlyHint: false, destructiveHint: true } }
  );

  return sdk.createSdkMcpServer({ name: agentOps.SERVER_KEY, version: '1.0.0', tools: [rename, end] });
}

// Descriptor half.
const descriptor = {
  enforcementPoint: 'held-callback',
  // ⚠ TRUE, and it is what makes a standing grant scopable to one shape. See the header.
  opScoped: true,
  // How the forced thread tag is applied. ⚠ `null` is not a legal answer for a shipped adapter:
  // without it agents stop self-filtering their own posts in a shared channel.
  inputRewrite: 'callback-updatedInput',
  // ⚠ ALWAYS THE UNIVERSAL HARD DENY, on every runtime. Dopl's own admin + retired tools, all
  // `mcp__dopl__*` — runtime-independent, and openable by no mode and no grant.
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = { makeCanUseTool, axisBTools, makeAgentOpsServer, applyRename, descriptor };

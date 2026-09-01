// AGENT-DRIVEN AGENT MANAGEMENT (2026-08-31, Samuel's ruling) — the in-process MCP server
// every desktop-spawned session carries: RENAME any of this operator's agents (itself
// included, and the common case: an orchestrator labelling its workers by role), and END
// another of them. Exposed to the model as `mcp__dopl_agents__rename_agent` /
// `mcp__dopl_agents__end_agent` via `session-query.js › buildSdkOptions`, which mounts the
// server beside the dopl HTTP entry and rides both names on `allowedTools`.
//
// ⚠ OWN-AGENTS-ONLY IS FREE HERE, NOT ENFORCED — the same sentence `session-ipc-ops.js`
// writes over `sessions:end`. Names live in the LOCAL electron-store (`agent-names.js`,
// "IDENTITY LIVES ON THIS MACHINE") and the registry holds only sessions THIS machine runs
// for THIS operator, so there is no cross-member agent to reach and nothing to refuse. A
// peer's agent is a handle in a channel read, never a row either tool can resolve.
//
// ⚠ WHY PRE-APPROVED (SDK allowedTools => SHADOWED, no button) RATHER THAN GATED. An
// unclassified tool GATES in every Axis-A mode, and a WINDOWLESS session's gate DENIES
// (`session-windowless.js › claimGate`) — so a gated verb here would be silently dead for
// exactly the sessions the ruling is about (channel-launched agents have no window). The
// shadow is honest for these two verbs because each is one the operator's own surfaces
// already carry ungated for the same subjects:
//   rename — `sessions:rename`'s contract verbatim: DISPLAY ONLY, never an address
//     (`agent-names.js`: nothing resolves an agent by this string, so a rename cannot
//     re-point a running instruction), sanitizer-bounded, local store, no network.
//   end — a STOP VERB that widens nothing (`sessions:delete`'s argument): it cannot start
//     a query, wake a shell, grant a tool or post; the failure direction of an abused call
//     is an agent that stops, on the machine of the operator whose agents they all are.
//
// ⚠ SELF-END IS REFUSED, and not out of caution for the agent: the dispatch would abort
// the CALLING turn mid-tool-call, so the tool result could never be delivered and the call
// would read as a hang rather than as an end. An agent that is finished just stops talking.
//
// ⚠ THE SERVER ITSELF MOVED TO THE RUNTIME ADAPTER ON 2026-08-31 (port step 3):
// `main/runtime/claude/axis-b.js › makeAgentOpsServer` builds it with THIS runtime's own
// MCP-server helpers off its cached SDK namespace, which is the one part of this feature that is
// platform-shaped. What stayed here is everything that is not: the two verb names (which are the
// WIRE), the rename-target rule, the end-verdict table and the two result shapes. ⚠ A NULL SERVER
// MUST NEVER BREAK A LAUNCH — the adapter answers null whenever the namespace is not cached or
// zod is unresolvable (a harness), and the session then runs without the two verbs, which is the
// pre-ruling behaviour, not an error.
//
// ⚠ IT IS ALSO THE SHAPE AN IN-PROCESS AXIS B WOULD USE, WITH THE OPPOSITE DISCIPLINE, and the
// adapter's header says so where a future adapter will read it: a runtime that implements its
// CHANNEL ops in-process must not inherit this file's pre-approval shadow, because a channel op
// is exactly the call that has to gate.

const SERVER_KEY = 'dopl_agents';
const RENAME_TOOL = 'mcp__' + SERVER_KEY + '__rename_agent';
const END_TOOL = 'mcp__' + SERVER_KEY + '__end_agent';
// The two names buildSdkOptions rides on allowedTools. ⚠ ORDER AND SPELLING ARE THE WIRE:
// the SDK prefixes with the mcpServers KEY, so SERVER_KEY and these literals must agree —
// derived, so they cannot drift apart.
const AGENT_OPS_TOOL_NAMES = [RENAME_TOOL, END_TOOL];

// ─── BEGIN AGENT-SELF-OPS-PURE (electron-free; unit-tested by direct require) ─────────

// The instance-id shape, restated from `agent-id.js › AGENT_ID_RE` via lazy require at the
// call sites… deliberately NOT: the predicate is needed inside this pure block, and
// `agent-id.js` is itself electron-free, so the ONE definition is required here directly.
const { isAgentId } = require('./agent-id');

// WHO IS BEING RENAMED. No id => SELF — the ergonomic default for "name yourself after your
// role" — and a malformed id is refused rather than coerced, so a typo cannot land a name
// on a fresh row nobody owns (`agent-names.js` stores against ANY key it is handed).
function renameTargetFor(selfId, requested) {
  const req = typeof requested === 'string' ? requested.trim().replace(/^@?agent-/, '') : '';
  if (!req) {
    const self = String(selfId || '');
    return self ? { ok: true, agentId: self } : { ok: false, reason: 'no-self' };
  }
  if (!isAgentId(req)) return { ok: false, reason: 'bad-agent-id' };
  return { ok: true, agentId: req };
}

// MAY THIS SESSION END THAT ONE. Pure over the caller's id, the requested id and the
// registry projection (`listLiveSessions()` rows), so the whole verdict table is testable
// without a session. `rows` carries only this operator's own sessions — the own-agents
// bound is the projection's, restated in the header above.
function endVerdict(selfId, requested, rows) {
  const req = typeof requested === 'string' ? requested.trim().replace(/^@?agent-/, '') : '';
  if (!isAgentId(req)) return { ok: false, reason: 'bad-agent-id' };
  if (req === String(selfId || '')) return { ok: false, reason: 'self' };
  const row = (Array.isArray(rows) ? rows : []).find(function (r) {
    return !!r && String(r.agentId || '') === req;
  });
  if (!row) return { ok: false, reason: 'no-session' };
  return { ok: true, row: row };
}

// CallToolResult helpers — the MCP shapes, spelled once.
function txt(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}
function refuse(text) {
  return { content: [{ type: 'text', text: String(text) }], isError: true };
}

// ─── END AGENT-SELF-OPS-PURE ──────────────────────────────────────────────────────────

module.exports = {
  SERVER_KEY,
  RENAME_TOOL,
  END_TOOL,
  AGENT_OPS_TOOL_NAMES, // ridden on allowedTools by buildSdkOptions — SHADOWED, see header
  // pure core (unit-tested directly; electron-free)
  renameTargetFor,
  endVerdict,
  txt,
  refuse,
};

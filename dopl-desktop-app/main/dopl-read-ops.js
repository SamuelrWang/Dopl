// Which ops of a MIXED Dopl tool only READ — the per-call half of "which dopl tool writes". A tool with ANY
// write op sits whole in `session-dopl-tools.js › DOPL_WRITE_TOOLS` (so Axis A below the widest mode, and every
// `preApproved`, stop at it) and its read ops are scoped back in here, resolving exactly where a Dopl read tool
// resolves (`session-profiles.js › grantDecision` step 5).
// ⚠ POSITIVE allow-lists, so a write op the server adds later is UNKNOWN here and gates.
// ⚠ Each row is pinned to the server's published `op` enum MINUS `packages/mcp-server/src/gating.ts › WRITE_OPS`
// by `test/dopl-write-op-gating.test.mjs` (and `dopl_kb`'s by `knowledge-read-ops.test.mjs`).
// ⚠ ONLY TOOLS A WINDOWLESS AGENT ALREADY READ. `dopl_skill` / `dopl_ontology` / `dopl_chats` gate whole, as
// they always have; scoping them is a widening, and a separate decision.

const { KNOWLEDGE_TOOL, KNOWLEDGE_READ_OPS } = require('./knowledge-ops');

const DOPL_READ_OPS = {
  [KNOWLEDGE_TOOL]: KNOWLEDGE_READ_OPS,
  'mcp__dopl__dopl_agent': ['list', 'get'],
  'mcp__dopl__dopl_workspaces': ['list'],
};

// The server's own default for an ABSENT `op`, where it has one: `dopl_workspaces` publishes `op` optional,
// `Default: "list"` (`meta-tools.ts › WORKSPACES_SHAPE`, and `{}` is its first documented example). Honoured
// only for an absent op — a non-string op is malformed and fails closed.
const DEFAULT_READ_OP = { 'mcp__dopl__dopl_workspaces': 'list' };

/** Is THIS CALL an op-scoped read? `canonicalName` is already canonicalised. Fail-closed on anything odd. */
function isDoplReadOpCall(canonicalName, input) {
  const reads = Object.prototype.hasOwnProperty.call(DOPL_READ_OPS, canonicalName) ? DOPL_READ_OPS[canonicalName] : null;
  if (!reads) return false;
  const raw = input && typeof input === 'object' ? input.op : undefined;
  const op = raw === undefined ? DEFAULT_READ_OP[canonicalName] : raw;
  if (typeof op !== 'string') return false;
  return reads.indexOf(op) !== -1;
}

module.exports = { DOPL_READ_OPS, isDoplReadOpCall };

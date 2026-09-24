// DOPL'S OWN TOOL SURFACE, SPLIT BY WHAT IT DOES TO THE SHARED WORKSPACE.
//
// ⚠ §2 SPLIT OUT OF `main/session-profiles.js` ON 2026-08-31 (runtime-adapter port, step 3). The
// two lists and the reason for the split are unchanged, word for word; what changed is that they
// now have to be reachable from BOTH sides of the runtime seam without a cycle.
//
// ⚠ THESE NAMES ARE RUNTIME-INDEPENDENT AND THAT IS WHY THEY LIVE IN CORE. Everything else Axis A
// resolves against — `READ_BUILTINS`, `EDIT_TOOLS`, `ESCALATION_TOOLS`, `BYPASS_READS` — is a
// vocabulary of one runtime's BUILT-IN tools and moved to that runtime's adapter
// (`main/runtime/claude/tools.js`). These are `mcp__dopl__*`: our server, our ops, the same on
// every runtime that can call an MCP tool at all. Each adapter's `tools.js` COMPOSES them into
// its own allow-lists rather than re-deriving them, because a second copy of "which dopl tool
// writes" is how one adapter comes to gate a read another allows.
//
// ⚠ A LEAF MODULE ON PURPOSE. `session-profiles.js` reads it, and so does every adapter's
// `tools.js` — which `session-profiles.js` reaches through `main/runtime/index.js`. Leaving these
// two lists in `session-profiles.js` would have made that a require cycle, and a cycle whose
// partial exports are TOOL LISTS resolves to `undefined` at exactly the moment a gate asks.

const { DOPL_SAFE_TOOLS } = require('./tool-profiles');

// ⚠ DOPL_SAFE_TOOLS is "non-admin", NOT "read-only". These six WRITE to the shared workspace — every
// tool `packages/mcp-server/src/gating.ts › WRITE_OPS` names bar `dopl_channel` (Axis B's). A
// write lands OFF this machine in rows every member reads — exfil, same class as an outbound
// post, so never silent. Split out so `auto` GATES them (only `bypass` covers them) and
// `dopl_only` stops SHADOWING them via allowedTools. Read half derived by subtraction; this list
// must stay a SUBSET of DOPL_SAFE_TOOLS — session-permission-hardening.test.mjs partition test.
// ⚠ A TOOL WITH ONE WRITE OP IS A WRITE TOOL (a read-list member rides `dopl_only.preApproved`, Claude's
// `auto` floor and every Cursor mode ungated). Read ops come back per call via `dopl-read-ops.js`;
// `test/dopl-write-op-gating.test.mjs` derives this membership from the server's WRITE_OPS.
const DOPL_WRITE_TOOLS = ['mcp__dopl__dopl_kb', 'mcp__dopl__dopl_skill',
  'mcp__dopl__dopl_ontology', 'mcp__dopl__dopl_chats',
  'mcp__dopl__dopl_agent', 'mcp__dopl__dopl_workspaces'];
const DOPL_READ_TOOLS = DOPL_SAFE_TOOLS
  .filter(function (t) { return DOPL_WRITE_TOOLS.indexOf(t) === -1; });

// ⚠ "WHERE DOES A DOPL READ RESOLVE?", ASKED OF THE TABLE RATHER THAN ANSWERED TWICE. The
// op-scoped read branch in `session-profiles.js › grantDecision` grants a mixed tool's READ op
// exactly where a `DOPL_READ_TOOL` is already granted. Naming those modes there would be a SECOND
// statement of AUTO_TOOLS' membership, which stops being true the day the floor or the lists
// move; asking the adapter's `axisAAllows` about a real member cannot drift.
const DOPL_READ_REFERENCE = DOPL_READ_TOOLS[0] || 'mcp__dopl__dopl_search';

module.exports = { DOPL_WRITE_TOOLS, DOPL_READ_TOOLS, DOPL_READ_REFERENCE };

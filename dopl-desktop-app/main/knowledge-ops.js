// Which `dopl_kb` ops only READ, so an identity's attached knowledge works on a windowless session (OQ-1). It
// classifies the CALL, not the tool: `dopl_kb` is a write tool, so read ops resolve where a Dopl read tool does
// (`auto`/`bypass`) and every write op keeps gating. A POSITIVE allow-list, so a new server write op is never
// silently allowed; knowledge-read-ops.test pins it as exactly `op enum - WRITE_OPS`. Pure (injected into the table).

// The canonical name `grantDecision` already normalized to; only `dopl_kb` (the other write tools have no consumer).
const KNOWLEDGE_TOOL = 'mcp__dopl__dopl_kb';

// `search` is filtered server-side to bases the caller may already read, so it discloses nothing `list_bases` would not.
const KNOWLEDGE_READ_OPS = ['list_bases', 'get_tree', 'list_dir', 'outline', 'read_file', 'search'];

/** Is THIS CALL a knowledge read? Fail-closed: another tool, a missing op or an unlisted op all answer false. */
function isKnowledgeReadCall(canonicalName, input) {
  if (canonicalName !== KNOWLEDGE_TOOL) return false;
  const op = input && input.op;
  if (typeof op !== 'string') return false;
  return KNOWLEDGE_READ_OPS.indexOf(op) !== -1;
}

module.exports = { KNOWLEDGE_TOOL, KNOWLEDGE_READ_OPS, isKnowledgeReadCall };

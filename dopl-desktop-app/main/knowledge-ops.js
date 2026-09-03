// OP-SCOPED KNOWLEDGE READS — the desktop's pinned copy of which `dopl_kb` ops only READ.
//
// ── ⚠ WHY THIS FILE EXISTS (2026-08-22, OQ-1, RESOLVED BY ORCHESTRATOR) ──────────────────────
//
// TOOL PERMISSION IS PER-TOOL, NOT PER-OP — except where this tree has deliberately made it
// per-op. `session-profiles.js` has always op-scoped `dopl_channel` (`OWN_CHANNEL_READ_OPS`,
// `OWN_CHANNEL_MARKER_OPS`, `isOwnChannelPost`) because ONE tool carries both a read and an
// exfil surface and a whole-tool verdict has to pick the wrong one. `mcp__dopl__dopl_kb` is the
// same shape: twelve ops, SEVEN of which write to the shared workspace.
//
// Because it writes, it sits in `DOPL_WRITE_TOOLS`, which keeps it out of `preApproved` and out
// of `AUTO_TOOLS`. So before this file the measured state was:
//
//   read_only   HARD-DENIED       (`DOPL_SAFE_TOOLS` goes into `disallowedTools` wholesale)
//   dopl_only   reachable, GATES  ⇒ and a windowless session has no gate surface, so DENY
//   full        reachable, GATES  ⇒ same
//
// i.e. THE ATTACHED-KNOWLEDGE HALF OF AN AGENT TEMPLATE COULD NOT FUNCTION AT ALL except under
// a `bypass` posture. The spec called it a blocker and asked whether to accept it. The ruling
// was to fix it, in the narrowest way that exists: classify the CALL, not the TOOL.
//
// ⚠ THE WIDENING IS EXACTLY FIVE OPS AND NOTHING ELSE. A read op resolves where a
// `DOPL_READ_TOOL` already resolves (`auto` and `bypass`, never `manual` / `accept_edits`); all
// seven write ops keep gating, which in a windowless session is a deny. `read_only` is
// untouched — the tool is hard-denied there, hard-deny is checked FIRST in `grantDecision`, and
// nothing here is reachable from that branch.
//
// ── ⚠ A POSITIVE ALLOW-LIST, AND THAT IS THE DEVIATION FROM "COPY THE WRITE SET" ─────────────
//
// The obvious construction is to hand-copy the server's `gating.ts › WRITE_OPS.dopl_kb` and
// treat everything else as a read. It is the WRONG DIRECTION and this file does the opposite:
// a NEW write op added server-side would then be UNKNOWN here and auto-allowed, which is a
// silent grant bought by someone else's unrelated commit. `session-profiles.js` already states
// the rule in its own words — "`auto` and `bypass` are POSITIVE ALLOW-LISTS, never negative …
// Unknown therefore GATES IN EVERY MODE" — and `OWN_CHANNEL_READ_OPS`, the pattern this mirrors,
// is likewise a list of READS.
//
// ⚠ SO THE WRITE SET IS STILL WHAT DEFINES THIS LIST — the derivation just happens in the TEST
// rather than at runtime. `test/knowledge-read-ops.test.mjs` parses BOTH
// `packages/mcp-server/src/gating.ts › WRITE_OPS.dopl_kb` AND the tool's own `op` enum out of
// `packages/mcp-server/src/tools/knowledge.ts`, and asserts this list is exactly
// `enum − WRITE_OPS`. A new read op that nobody adds here fails that test (a gap, not a grant);
// a new WRITE op fails it too (a stale list, still not a grant). The hand-copy discipline
// `gating.ts` documents for its own consumers is kept, with the copy pointing the safe way.
//
// PURE — no electron / fs / path — so `session-profiles.js`'s extracted table can take it as an
// injected parameter exactly like `normalizeProfile` and the two name normalizers.

// The tool this file classifies, in the CANONICAL form `session-profiles.js › grantDecision`
// has already normalized the caller's name onto (`mcp-tool-names.js › canonicalDoplName`).
// ⚠ ONE NAME, DELIBERATELY. `dopl_skill`, `dopl_ontology` and `dopl_chats` are the other three
// members of `DOPL_WRITE_TOOLS` and are ABSENT on purpose: nothing in the product points a
// windowless agent at them the way a template's attached bases point it at `dopl_kb`, and a
// classification with no consumer is a widening bought for nothing. Add one when something asks
// for it, with its own parity pin.
const KNOWLEDGE_TOOL = 'mcp__dopl__dopl_kb';

// ⚠ THE READ OPS, AS OF 2026-08-22, DERIVED BY SUBTRACTION AND PINNED BY TEST.
//   enum      list_bases get_tree list_dir create_base update_base create_folder move_folder
//             read_file write_file move_file search set_visibility           (knowledge.ts)
//   WRITE_OPS create_base update_base create_folder move_folder write_file move_file
//             set_visibility                                                 (gating.ts)
//   ⇒ reads   list_bases get_tree list_dir read_file search
//
// ⚠ `search` IS A READ AND IT IS NOT `dopl_channel op="rooms", action="list"`. The reason that one is kept OFF
// `OWN_CHANNEL_READ_OPS` is that it enumerates OTHER PEOPLE'S channels and DMs; `dopl_kb`
// op="search" is server-side filtered to bases this caller may already read, so it discloses
// nothing a `list_bases` would not. Both are the caller's own reach, never a peer's.
const KNOWLEDGE_READ_OPS = ['list_bases', 'get_tree', 'list_dir', 'read_file', 'search'];

/**
 * Is THIS CALL a knowledge READ? Takes the CANONICAL tool name and the tool input.
 *
 * ⚠ FAIL-CLOSED THREE WAYS: a different tool, a missing/non-string `op`, and any op not on the
 * positive list above all answer `false`, which leaves `grantDecision` exactly where it was —
 * `gate`, and a windowless gate is a deny.
 */
function isKnowledgeReadCall(canonicalName, input) {
  if (canonicalName !== KNOWLEDGE_TOOL) return false;
  const op = input && input.op;
  if (typeof op !== 'string') return false;
  return KNOWLEDGE_READ_OPS.indexOf(op) !== -1;
}

module.exports = { KNOWLEDGE_TOOL, KNOWLEDGE_READ_OPS, isKnowledgeReadCall };

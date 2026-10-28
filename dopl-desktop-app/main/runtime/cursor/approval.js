// AXIS A's ANSWER SHAPE — with a caveat: this runtime has no Axis-A answer channel at all.
//
// ⚠ NO PROGRAMMATIC PERMISSION CALLBACK (`cursor-research.md`): hooks are file-based only, the one
// interactive gate is ACP's `session/request_permission` (a different transport that costs team MCP
// servers), and the SDK's `request` stream event has no responder API (§5 item X1). So
// `descriptor.heldCallback` is `false` as a MEASUREMENT. A Cursor built-in (shell, file write, web
// fetch) is supervised by CURSOR — run mode, classifier, sandbox, the permission strings in
// `tools.js` — never by `grantDecision`. Dopl does not synthesise an ask it cannot enforce
// (decision 1; hooks `ask` is not enforced for `preToolUse` and hooks fail open).
// ⚠ AXIS B IS UNAFFECTED: Dopl's own tools are `local.customTools` this process implements
// (`axis-b.js`). So `answerApproval` writes a TOOL RESULT, not an approval reply; the rules are
// still decided once, in `grantDecision`.
//
// ⚠ THE RESULT SHAPE IS MCP's `CallToolResult`: `customTools` are registered as a built-in
// `custom-user-tools` MCP server, so `execute()` returns what an MCP tool returns — built by the same
// `agent-self-ops.js › txt` / `› refuse` the other runtime's in-process server uses. If it turns
// out otherwise (§5 item X15) it is a one-function change: nothing else here builds a result.
const ops = require('../../agent-self-ops');

/**
 * The reply the MODEL reads for one gated call.
 *
 * `request` — `{ message, text }`: the deny sentence, or the tool's output on an allow.
 * `verdict` — `'allow'`, or anything else, which denies.
 *
 * ⚠ FAIL CLOSED ON ANYTHING BUT AN EXPLICIT ALLOW (same rule as
 * `session-permissions.js › resolvePerm`).
 * ⚠ A DENY IS `isError`, NOT SILENCE: a model that cannot tell "refused" from "empty" retries the
 * refused post — the fan-out shape.
 */
function answerApproval(request, verdict) {
  const req = request || {};
  if (verdict === 'allow') return ops.txt(req.text == null ? '' : req.text);
  return ops.refuse(req.message || 'Denied by operator');
}

/**
 * Apply the forced thread tag by this runtime's declared route (`axisB.inputRewrite: 'native'`).
 *
 * ⚠ THE TAG IS AN INVARIANT, NOT A REQUEST: agents omit the thread argument even when the prompt
 * names it (measured; `session-outbound-tag.js` header). The value is the session's own thread id,
 * from the spawn spec on THIS machine, never off the wire.
 * ⚠ `'native'`: Dopl WRITES the tool, so the stamp is applied before the call leaves this process,
 * with no platform mechanism (allow `updatedInput`, hook stdout) to smuggle it through.
 *
 * `input` — the arguments the model passed to the custom tool.
 * `tag`   — `session-outbound-tag.js › threadTagFor`'s answer.
 * ⚠ `null` IS NOT A LEGAL RETURN: a tag that does not apply answers the input UNCHANGED.
 */
function stampOutbound(input, tag) {
  const base = input && typeof input === 'object' ? input : {};
  if (!tag || tag.action !== 'inject') return { updatedInput: base };
  return { updatedInput: tag.input };
}

// Descriptor half — AXIS A ONLY. Axis B's enforcement point is `axis-b.js`'s.
const descriptor = {
  // ⚠ FALSE — the one `false` across the three adapters. See the header.
  heldCallback: false,
  // ⚠ null: with no callback there is no granularity. Axis A here is a RUN MODE
  // (`toolMode.options`), not a question it asks us.
  granularity: null,
  // ⚠ null, not []: no category vocabulary exists; inventing one is what decision (1) forbids.
  categories: null,
};

module.exports = { answerApproval, stampOutbound, descriptor };

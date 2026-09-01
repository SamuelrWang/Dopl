// AXIS A's ANSWER SHAPE — and on THIS runtime that sentence needs a caveat, because there is no
// Axis-A answer channel at all.
//
// ⚠ THE PLATFORM HAS NO PROGRAMMATIC PERMISSION CALLBACK. `cursor-research.md` is explicit: hooks
// are FILE-BASED only, with no programmatic callbacks, and the one documented interactive gate is
// ACP's `session/request_permission` — a different transport (`cursor-agent acp`) that costs team
// MCP servers and that the design's step 8 does not take. The SDK's `request` stream event
// (`{type:'request', request_id}`, "awaiting approval") is LISTED WITH NO RESPONDER API, which is
// §5 item X1. So `descriptor.heldCallback` is `false`, and it is false as a MEASUREMENT rather
// than as a shrug.
//
// ⚠ WHAT THAT COSTS, STATED PLAINLY: a CURSOR BUILT-IN — a shell command, a file write, a web
// fetch — is supervised by CURSOR (its run mode, its classifier, its sandbox, and the permission
// strings in `tools.js`), and never by `grantDecision`. Dopl does not synthesise a per-tool ask it
// cannot enforce; decision (1) forbids exactly that, and a "Ask each time" row that a hook shim
// half-honours would be worse than an absent one (`cursor-research.md`: `ask` is not enforced for
// `preToolUse`, and hooks FAIL OPEN unless `failClosed` is set on every event).
//
// ⚠ AND WHAT IT DOES NOT COST: AXIS B. Dopl's own tools are `local.customTools` this process
// implements, so the outbound consent card has a real mechanism here — see `axis-b.js`. That
// separation is the whole reason `approval.heldCallback: false` is survivable on this runtime and
// would not have been on either of the others.
//
// ⚠ SO `answerApproval` WRITES A TOOL RESULT, NOT AN APPROVAL REPLY. The only place a Dopl verdict
// can be expressed on this runtime is the RETURN VALUE of a tool Dopl implements. The rules are
// still Dopl's and still decided once, in `grantDecision`; this file only writes that decision in
// the shape the model reads back.

// ── THE RESULT SHAPE ─────────────────────────────────────────────────────────────────────────
//
// ⚠ MCP's `CallToolResult`, AND THE JOIN IS DOCUMENTED RATHER THAN GUESSED: `cursor-research.md`
// says `local.customTools` are "registered as a built-in `custom-user-tools` MCP server", so what
// an `execute()` returns is what an MCP tool returns. It is byte-identical to the shape
// `main/agent-self-ops.js › txt` / `› refuse` already build for the other runtime's in-process
// server, which is the same mechanism — so the two cannot drift into two answers for one protocol.
// ⚠ IF THE SHAPE TURNS OUT TO BE OTHER THAN THIS, it is §5 item X15 and it is a one-function
// change, because nothing else in this adapter builds a result.
const ops = require('../../agent-self-ops');

/**
 * The reply the MODEL reads for one gated call.
 *
 * `request` — `{ message, text }`. `message` is the sentence a deny carries; `text` is the tool's
 * own output on an allow.
 * `verdict` — Dopl's answer: `'allow'`, or anything else, which denies.
 *
 * ⚠ FAIL CLOSED ON ANYTHING BUT AN EXPLICIT ALLOW. An unknown verdict, `undefined`, a thrown
 * object — all deny. Same rule `main/session-permissions.js › resolvePerm` applies to the
 * operator's own click, restated here because this is the other end of the same promise.
 * ⚠ A DENY IS `isError`, NOT SILENCE. The model has to be able to tell "refused" from "empty
 * result", or it retries the post it was refused — which is the fan-out shape, not a cosmetic one.
 */
function answerApproval(request, verdict) {
  const req = request || {};
  if (verdict === 'allow') return ops.txt(req.text == null ? '' : req.text);
  return ops.refuse(req.message || 'Denied by operator');
}

/**
 * Apply the forced thread tag by this runtime's declared route (`axisB.inputRewrite: 'native'`).
 *
 * ⚠ THE TAG IS AN INVARIANT, NOT A REQUEST. The delivery prompt already names the thread and the
 * agent omits the argument anyway — measured, with an incident behind it
 * (`main/session-outbound-tag.js`'s header). The value is the session's own task id, which comes
 * from the spawn spec ON THIS MACHINE and never off the wire.
 *
 * ⚠ `'native'` IS THE EASIEST ROUTE OF THE THREE AND IT IS WORTH SAYING WHY. The other two
 * runtimes have to smuggle the rewrite through something the platform owns — an allow object's
 * `updatedInput`, or a hook's stdout — and each of those is a §5 item. Here Dopl WRITES THE TOOL,
 * so the stamp is applied to the arguments before the call leaves this process and there is no
 * platform mechanism to verify. That is the one place this adapter is strictly stronger than the
 * others, and it falls out of `axisB.enforcementPoint: 'in-process'` rather than being bought.
 *
 * `input` — the arguments the model passed to the custom tool.
 * `tag`   — `session-outbound-tag.js › threadTagFor`'s answer.
 * ⚠ `null` IS NOT A LEGAL RETURN: an un-stamped post is a fan-out/echo failure, so a tag that does
 * not apply answers the input UNCHANGED rather than nothing.
 */
function stampOutbound(input, tag) {
  const base = input && typeof input === 'object' ? input : {};
  if (!tag || tag.action !== 'inject') return { updatedInput: base };
  return { updatedInput: tag.input };
}

// Descriptor half — AXIS A ONLY. Axis B's enforcement point is `axis-b.js`'s.
const descriptor = {
  // ⚠ FALSE, AND IT IS THE ONE `false` IN THIS FIELD ACROSS ALL THREE ADAPTERS. See the header:
  // no programmatic callback, hooks are file-based and out of scope, ACP is a different transport.
  heldCallback: false,
  // ⚠ null, not `'per-tool'` and not `'category'`. With no callback there is no granularity to
  // declare — this runtime's Axis A is a RUN MODE, not a question it asks us. `toolMode.options`
  // is where that mode vocabulary lives.
  granularity: null,
  // ⚠ null, not []. No category vocabulary at all; inventing one inside the descriptor whose whole
  // purpose is to enforce NATIVE vocabulary is the exact failure decision (1) exists to prevent.
  categories: null,
  // ⚠ FALSE, AND THE REASON IS A TRANSPORT FACT RATHER THAN A PREFERENCE. `allow-always` is an ACP
  // outcome (`allow-once` | `allow-always` | `reject-once`) and step 8 ships the SDK path, which
  // has no approval channel to answer at all — so there is no native session grant to double-count
  // against. Dopl's own scoped grant key is the only "stop asking" ledger here, which is the state
  // the never-double-count invariant wants and gets for free.
  sessionGrant: false,
  // ⚠ false: the run mode is fixed for the life of the agent handle (`Agent.create()` takes it),
  // and nothing in the research shows it changing mid-session. Dopl's OWN gate reads both axes
  // live at decision time either way, so a posture change is never stale where it matters — it
  // takes effect on the next launch for CURSOR's half and immediately for Dopl's.
  hotSwapModes: false,
};

module.exports = { answerApproval, stampOutbound, descriptor };

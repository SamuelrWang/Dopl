// AXIS A's ANSWER SHAPE — how Dopl's four verdicts become THIS platform's reply to a held call.
//
// ⚠ THE RULES ARE DOPL'S; ONLY THE SHAPE IS THE PLATFORM'S. `main/session-profiles.js ›
// grantDecision` decides, in one place, with one order. This file does nothing but write that
// decision in the words this runtime's permission callback answers in. A second decision here
// would be a gate in two places, which is the failure F-228 / 1.7.10 bought.
//
// ⚠ FAIL CLOSED ON ANYTHING BUT AN EXPLICIT ALLOW. An unknown verdict, `undefined`, a thrown
// object — all deny. That is the same rule `main/session-permissions.js › resolvePerm` applies to
// the operator's own click, restated here because this is the OTHER end of the same promise.

const outboundTag = () => require('../../session-outbound-tag');

/**
 * The platform's reply object for one held call.
 *
 * `request` — `{ tag, message }`. `tag` is the forced thread tag (`session-outbound-tag.js ›
 * threadTagFor`) or null; `message` is the sentence a deny carries, which the OPERATOR sees.
 * `verdict` — Dopl's answer: `'allow'` or anything else, which denies.
 *
 * ⚠ THE TAG RIDES A VERDICT, IT NEVER MAKES ONE. It is applied only on the allow branch, and a
 * deny carries nothing: an injected argument on a refused call would be a rewrite of a request
 * nobody approved.
 */
function answerApproval(request, verdict) {
  const req = request || {};
  if (verdict === 'allow') return outboundTag().allowResult(req.tag || null);
  return { behavior: 'deny', message: req.message || 'Denied by operator' };
}

/**
 * Apply the forced thread tag by this runtime's declared route (`axisB.inputRewrite`).
 *
 * ⚠ THE TAG IS AN INVARIANT, NOT A REQUEST, and that is why this method exists at all. The
 * delivery prompt already names the thread and the agent omits the argument anyway — measured,
 * with an incident behind it (`main/session-outbound-tag.js`'s header). The value is the
 * session's own task id, which comes from the spawn spec ON THIS MACHINE and never off the wire,
 * so no server can supply it and no prompt can be trusted to carry it.
 * ⚠ `null` IS NOT A LEGAL RETURN. A runtime with no input-rewrite route stops agents
 * self-filtering their own posts in a shared channel — a fan-out/echo failure, not a cosmetic
 * one — and declares that by refusing to register, not by answering nothing here.
 *
 * On THIS runtime the route is the held callback's own allow object, so the answer is a fragment
 * merged into that allow. `result` is the reply being built; `tag` is what to stamp.
 */
function stampOutbound(result, tag) {
  const base = result && typeof result === 'object' ? result : { behavior: 'allow' };
  if (!tag || tag.action !== 'inject') return base;
  if (base.behavior !== 'allow') return base; // a deny carries no rewrite, ever
  return Object.assign({}, base, { updatedInput: tag.input });
}

// Descriptor half — AXIS A ONLY. Axis B's enforcement point is `axis-b.js`'s.
const descriptor = {
  // ⚠ TRUE, AND IT IS THE CAPABILITY THE PRODUCT CANNOT DEGRADE GRACEFULLY WITHOUT. A held
  // pre-execution callback that BLOCKS the turn is what makes `gate` representable at all;
  // without it `preapproved` and `deny` survive as pre-flight lists and the outbound consent card
  // — the operator seeing the bytes before they leave the machine — has no mechanism.
  heldCallback: true,
  granularity: 'per-tool',
  // ⚠ null, not []. This runtime has no category vocabulary of its own, and inventing category
  // names inside the descriptor whose whole purpose is to enforce NATIVE vocabulary is the exact
  // failure the no-synthesised-modes rule exists to prevent.
  categories: null,
  // ⚠ false: the "stop asking for the rest of this task" affordance here is DOPL'S OWN, a scoped
  // grant key over the shape the operator was shown. Declaring a native one too would invite the
  // double-count class of defect — one click recorded twice, on two ledgers.
  sessionGrant: false,
  // ⚠ false: a mode change takes effect on the NEXT call because the gate reads both axes live at
  // decision time, but the platform's own mode is pinned for the life of the child and is not
  // hot-swappable. Nothing in this product needs it to be; declared so the UI offers no live-swap.
  hotSwapModes: false,
};

module.exports = { answerApproval, stampOutbound, descriptor };

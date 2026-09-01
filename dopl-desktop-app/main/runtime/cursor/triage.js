// TRIAGE — ⚠ THIS RUNTIME DOES NOT RUN IT, AND THAT IS A REFUSAL WITH A REASON.
//
// ⚠ `descriptor.triage` IS `null` AND `triageSpec()` ANSWERS `null`. Triage is a SECOND spawn
// shape whose every field is a FENCE, because the call READS UNTRUSTED GUEST TEXT and must not be
// able to act on it. The Claude adapter's four layers are:
//   mcpServers: {}     no Dopl surface at all — no channel read, no post, no knowledge
//   canUseTool: deny   EVERY tool call refused. Load-bearing there because that platform has no
//                      "offer no tools" option, so the gate has to express it
//   maxTurns: 1        one assistant turn — even a denied tool call cannot be retried
//   settingSources:[]  no operator settings file can short-circuit the gate
//
// ⚠ THIS RUNTIME CAN EXPRESS TWO OF THE FOUR CLEANLY AND CANNOT EXPRESS THE OTHER TWO AT ALL, and
// the split is not the same one the other native runtime has:
//   ✔ NO DOPL SURFACE is trivially expressible, and MORE cleanly than anywhere else: Dopl's tools
//     are `customTools` THIS PROCESS registers, so registering none is a complete answer rather
//     than a config the host might override. `mcpSurface: 'none'` would be honest.
//   ✔ NO OPERATOR SETTINGS is partly expressible — `disallowedTools` beats an operator's allow.
//   ✘ NO TURN BOUND. Nothing in `cursor-research.md` documents a `maxTurns` analogue for
//     `agent.send()`. §5 item X6.
//   ✘ NO TOOL SURFACE. `tools: [...]` is documented as an allowlist, but in WHAT VOCABULARY its
//     entries are read is unsettled (§5 item X14) — and an empty positive bound is exactly the
//     shape that means "no bound at all" on the other runtime that has one. A fence that might
//     mean its own opposite is not a fence.
//
// And the design is unambiguous about what an unanswered `turnBound` means:
//
//   > `triage.turnBound: null` IS LAUNCH-BLOCKING: an unbounded triage turn reading untrusted text
//   > is an unfenced one.
//
// ⚠ SO THE HONEST v1 ANSWER IS "NO TRIAGE ON CURSOR", NOT "TRIAGE WITH TWO FENCES MISSING".
// Declaring a `triage` object with `turnBound: null` would be refused by
// `test/runtime-contract.test.mjs`; declaring one with a NUMBER we cannot enforce would be worse —
// a fence that is declared but not applied is a lie the conformance suite would then certify.
//
// ⚠ AND ONE FENCE IS WEAKER HERE THAN ANYWHERE, WHICH IS WORTH SAYING EVEN THOUGH IT IS MOOT
// TODAY. Triage's whole risk is a run that ACTS on guest text, and on this runtime Dopl cannot
// stop a run it started (§5 item X0). On Claude an over-running triage call is aborted; here it
// would not be. That raises the bar for reopening this rather than lowering it: X6 answering
// "there is a turn bound" is necessary and, while X0 is open, not sufficient.
//
// ⚠ WHAT THIS COSTS, MEASURED RATHER THAN WAVED AT. Triage is wake tier 3: the pass that lets a
// DORMANT agent claim a guest message nobody was addressed by. A Cursor agent therefore never
// claims one; it still wakes on every other tier (an @-mention, a direction, an addressed reply,
// the solo tier). `main/session-triage.js › claimOne` already treats an unavailable runtime as a
// PASS — its `catch` logs "call failed … (reads as PASS)" and nobody wakes — so a null spec
// degrades to "this agent did not claim", which is the same outcome as losing the race. Nothing
// hangs and nothing is silently granted.
//
// ⚠ AND IT IS DELIBERATELY NOT ROUTED THROUGH ANOTHER ADAPTER. "Use Claude's triage for a Cursor
// session" is a tempting one-liner and it breaks the thing the whole port is for: the operator
// chose a runtime, and spending a different vendor's model — on a different credential, under a
// different fence — to decide whether their Cursor agent wakes is a decision nobody made.
//
// X6 (with X0) is what re-opens this. Answer both and `triage` becomes a descriptor object plus a
// bounded `agent.send()`; nothing else here changes.

/**
 * ⚠ `null` IS THE DECLARED ANSWER, NOT AN ERROR. `main/runtime/contract.js` documents the return
 * as "the opaque triage launch payload, or `null`", and `descriptor.triage` is the readable half
 * so a caller can know before it asks.
 */
function triageSpec(_request) {
  return null;
}

// Descriptor half — ⚠ `null` means "this runtime cannot triage", and the conformance suite skips
// every fence assertion for it (`if (t === null) continue`). An OBJECT here is a promise that all
// seven fences are real.
const descriptor = null;

module.exports = { triageSpec, descriptor };

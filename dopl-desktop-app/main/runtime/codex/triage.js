// TRIAGE — ⚠ THIS RUNTIME DOES NOT RUN IT, AND THAT IS A REFUSAL WITH A REASON.
//
// ⚠ `descriptor.triage` IS `null` AND `triageSpec()` ANSWERS `null`. Triage is a SECOND spawn
// shape whose every field is a FENCE, because the call READS UNTRUSTED GUEST TEXT and must not be
// able to act on it. The Claude adapter's four layers are:
//   mcpServers: {}     no Dopl surface at all — no channel read, no post, no knowledge
//   canUseTool: deny   EVERY tool call refused. ⚠ Load-bearing: that platform has no "offer no
//                      tools" option, so the gate has to express it
//   maxTurns: 1        one assistant turn — even a denied tool call cannot be retried
//   settingSources:[]  no operator settings file can short-circuit the gate
//
// TWO OF THOSE FOUR HAVE NO DOCUMENTED ANALOGUE ON THIS RUNTIME, and both are the load-bearing
// ones. `codex-research.md` documents no `maxTurns` equivalent for `turn/start` and no way to
// launch a turn offering no tools at all. Those are exactly §5 item C5's two questions, and the
// design is unambiguous about what an unanswered `turnBound` means:
//
//   > `triage.turnBound: null` IS LAUNCH-BLOCKING: an unbounded triage turn reading untrusted text
//   > is an unfenced one.
//
// ⚠ SO THE HONEST v1 ANSWER IS "NO TRIAGE ON CODEX", NOT "TRIAGE WITH TWO FENCES MISSING".
// Declaring a `triage` object with `turnBound: null` would be refused by
// `test/runtime-contract.test.mjs`; declaring one with a NUMBER we cannot enforce would be worse —
// a fence that only one of two spawn shapes applies is not a fence, and a fence that is declared
// but not applied is a lie the conformance suite would then certify.
//
// ⚠ WHAT THIS COSTS, MEASURED RATHER THAN WAVED AT. Triage is wake tier 3: the pass that lets a
// DORMANT agent claim a guest message nobody was addressed by. A Codex agent therefore never
// claims one; it still wakes on every other tier (an @-mention, a direction, an addressed reply,
// the solo tier). `main/session-triage.js › claimOne` already treats an unavailable runtime as a
// PASS — its `catch` logs "call failed … (reads as PASS)" and nobody wakes — so a null spec
// degrades to "this agent did not claim", which is the same outcome as losing the race. Nothing
// hangs and nothing is silently granted.
//
// ⚠ AND IT IS DELIBERATELY NOT ROUTED THROUGH THE CLAUDE ADAPTER. "Use Claude's triage for a Codex
// session" is a tempting one-liner and it breaks the thing the whole port is for: the operator
// chose a runtime, and spending a different vendor's model — on a different credential, under a
// different fence — to decide whether their Codex agent wakes is a decision nobody made.
//
// C5 is what re-opens this. Answer it and `triage` becomes a descriptor object plus a
// `turn/start` with the bound it names; nothing else here changes.

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

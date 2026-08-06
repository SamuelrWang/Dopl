'use strict';

// THE POST SURFACE — who a post is really addressed to, and what kind it claims to be.
//
// §2 SPLIT (2026-08-06). This block lived in `session-io.js`, which sat at EXACTLY 500 lines
// with zero headroom (ENGINEERING.md §2 names it as one of three such files). Threading the
// counterparty id through `withPostSurface` — so `to` is a display NAME rather than the raw
// user id an agent typed — pushed it to 524, and §2 is explicit that an edit to an over-cap
// file either splits it or shrinks it. The reflex alternative is deleting a comment, which is
// how eight files in this tree converged on the same two numbers; this takes the real seam
// instead.
//
// AND IT IS A REAL SEAM, not a line-count dodge: the block was ALREADY marked pure and
// already sliced out of its host by source extraction, so it was a module in everything but
// filename. It has no electron, no I/O and no state — the whole reason it could be unit-tested
// by evaluating its own source.
//
// `session-io.js` re-exports `withPostSurface`, so `io.withPostSurface(...)` keeps working for
// every existing caller (`session-outbound.js` reaches it that way).

// ─── BEGIN SESSION-IO-POST-SURFACE (pure; unit-tested via source extraction) ───
// MEDIUM-2 — WHO this post is really addressed to, and WHAT kind it claims to be. The card used
// to print the session's bound counterparty for every post, so a post addressed to a DIFFERENT
// channel member (`to:`) or forged as a lifecycle event (`kind:task_finished`) looked exactly like
// a plain reply. Both now ride the payload and are painted (session-labels.postDestinationText),
// and both are folded into the grant key, so approving one reply cannot authorize either.
const TO_CAP = 60;
const KIND_CAP = 40;
// FIX F9 (v2.9 review) — THE KEY AND THE CARD MUST NAME THE SAME THING. postScope keys ANY
// non-'message' kind, but this named only the four-value enum, so `kind:'Task_Finished'` earned
// its OWN grant key while the card showed NOTHING and the operator approved what read as a plain
// reply. Every non-empty kind is rendered now. And a NON-STRING `to`/`kind` is never rendered as a
// value it is not (String({a:1}) is '[object Object]', String(['alice']) is 'alice'), so a
// malformed field says so in plain words — and grantDecision refuses to auto-allow those calls at
// all (postFieldsOk), so this label is always shown before anything is sent.
function oneLineField(value, cap) {
  const raw = String(value).replace(/\s+/g, ' ').trim();
  return raw.length > cap ? raw.slice(0, cap - 1).trimEnd() + '…' : raw;
}
function postAddress(input) {
  const to = input ? input.to : null;
  if (to == null || to === '') return null; // unaddressed -> the bound counterparty
  return typeof to === 'string' ? (oneLineField(to, TO_CAP) || null) : 'an invalid recipient';
}
function postKindOf(input) {
  const k = input ? input.kind : null;
  if (k == null || k === '' || k === 'message') return null; // the plain-chat default
  return typeof k === 'string' ? (oneLineField(k, KIND_CAP) || null) : 'an invalid kind';
}
// Stamp the two fields on a post payload, ONLY when they are really set: an absent field
// must leave the payload byte-identical to the one every existing surface already renders.
//
// `counterpartyId` (2026-08-06) IS WHAT KEEPS `to` A DISPLAY NAME. Both call sites below
// already document the contract — "`to` is a display NAME and ownChannel a boolean" — and
// this function was the one place that broke it: `postAddress` returns the caller's `to`
// ARGUMENT verbatim, and the tool description invites addressing by "an email or user id".
// So an agent that addressed by id painted `Sent to 2dac1943-da3b-4fd9-aee6-1716ddfc25f9`
// on the operator's own card while the SERVER's echo of the same post said "addressed to
// Samuel Wang". Observed live 2026-08-06.
//
// THE MAPPING IS THE ONE THIS SESSION ALREADY HOLDS, deliberately — no member lookup, no new
// dependency, and this block stays pure. The session knows its counterparty's id AND name
// (`s.counterpartyId` / `s.counterpartyName`), which covers addressing the person you are
// actually talking to. Anything else — a third member in a group channel, an email — is
// LEFT VERBATIM rather than guessed at, which is the same thing it did before.
function withPostSurface(payload, input, fallbackTo, counterpartyId) {
  const addressed = postAddress(input);
  const kind = postKindOf(input);
  // Resolve ONLY an exact match on the bound counterparty, and only when a name exists to
  // put in its place: a partial match or a missing name keeps the raw string, because a
  // wrong name is worse than an ugly id.
  const named =
    addressed && counterpartyId && fallbackTo && addressed === counterpartyId
      ? fallbackTo
      : addressed;
  payload.to = named || fallbackTo || null;
  // `addressed` STAYS DERIVED FROM THE CALL, not from the label. It answers "did this call
  // name a recipient", which is what the renderer's `named` check reads to decide between
  // "Sent to X" and "Posted to channel" — resolving the id to a name must not change that.
  if (addressed) payload.addressed = true;
  if (kind) payload.postKind = kind;
  return payload;
}
// ─── END SESSION-IO-POST-SURFACE ──────────────────────────────────────────────

module.exports = { TO_CAP, KIND_CAP, oneLineField, postAddress, postKindOf, withPostSurface };

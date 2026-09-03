// H2 — is a DM post STAMPED with the fact that the server addresses it? (2026-07-31, restored
// F-145; cut down to main's half 2026-08-20 with the session-window retirement, F-228)
//
// THE BEHAVIOUR. main stamps `to` on EVERY own-channel post: the call's own `to:` when it set
// one, and the session's BOUND COUNTERPARTY otherwise (main/session-io.js `withPostSurface`).
// That fallback is a 1:1 INFERENCE, so N-PARTY made the consumer refuse to name a person on an
// unaddressed post — and that overcorrected the one case that is all of today's live traffic.
// In a DIRECT channel the SERVER addresses the post (`resolveDirectPeer` stamps `to_user_id`
// with the other member, which is exactly why the tool tells an agent it needs no `to` there),
// so "no recipient named" was said about a message that goes to David and wakes David's agent.
// An approval card that UNDERSTATES the blast radius is the same defect as one that overstates
// it, and this is the boolean that separates them: main stamps `directChannel` from the
// server's own `isDirect` flag, FAIL-QUIET — only an explicit `true` names anyone.
//
// WHAT THIS FILE COVERS NOW: the PRODUCER side only. Where `directChannel` comes from, that it
// can only ever be the server's own flag, that it rides BOTH the gated and the auto-allowed post
// paths identically, that it survives every surviving session-start path, and that the `to` it
// travels with is a display NAME rather than the raw user id an agent typed. All of it is
// `main/session-io.js` / `session-outbound.js` / `session-post-surface.js`, and all of it still
// ships. See the ⚠ block below for the consumer half and why it is gone.
//
// WHY THIS FILE EXISTS AT ALL (F-145). These assertions lived in
// `test/session-addressee-truth.test.mjs`, a MIXED file: the N-PARTY half (an unaddressed post
// names the channel) and the H2 half (a DM names the peer) plus a composer-popup section for
// the `@`-mention syntax. The channels rollback deleted the mention syntax, and the whole file
// went with it. The H2 half survived NOWHERE — not one test in this tree so much as mentioned
// `directChannel`, and every line that implements it could be deleted with 2293 tests still
// green. INVARIANTS §14: a mixed file whose feature is deleted is REWRITTEN down to the
// behaviour that survives, not removed. This file is that rewrite, and it has now been through
// the same operation a second time, for the same reason, on the other half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const io = require(M("session-io.js"));
// ⚠ 2026-08-31 (runtime-adapter port, step 3): `makeCanUseTool` SPLIT. The verdict plumbing, the
// diag line, the card payloads and the resolver parking are platform-free and live in
// `main/session-gate-bridge.js`; what remains under this name is the HELD-CALLBACK WIRING and the
// platform's own reply vocabulary, which is the adapter's. The tests below drive the shipped
// callback, so they take it from there.
const axisB = require(M("runtime/claude/axis-b.js"));
const outbound = require(M("session-outbound.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

// ── ⚠ THE APPROVAL CARD'S COPY — REMOVED 2026-08-20, both surfaces are deleted ─
//
// WHAT STOOD HERE: five tests over `renderer/session/session-labels.js › postDestinationText`
// (the card's destination LINE) and `renderer/session/session-render.js › outboundLabel` (the
// record BANNER) — the two places the flag below was consumed.
//   - "H2: in a DIRECT channel the SERVER names the recipient, so the card does too"
//   - "H2: the DM flag is FAIL-QUIET — a near-miss names nobody, and never invents one"
//   - "H2: the banner names the DM recipient on the same rule as the destination line"
//   - "H2 does NOT weaken the cross-channel verdict (fail suspicious still outranks it)"
//   - "H2: the destination line and the banner never disagree about naming"
//   - "H2: the copy is plain and carries no em dash"
//
// WHY THEY ARE GONE: `renderer/session/**` was deleted whole with the v1 session window (F-228).
// There is no destination line and no banner. A test that re-implements `postDestinationText`
// to keep asserting "To: David" would be asserting against itself.
//
// ⚠ THE ONE THAT WAS DOING REAL WORK, and that a replacement UI must re-earn: "the destination
// line and the banner never disagree about naming". It was a CROSS-SURFACE consistency proof —
// it swept every (addressed × directChannel) combination and asserted the two independently
// written formatters either both named the person or neither did. That class of bug (one surface
// says "Sent to David", the other says "Posted to channel", for the same payload) is invisible to
// per-formatter tests, which is exactly why it was written as a sweep. Any future surface that
// paints this payload in two places inherits that obligation. Nothing in this tree holds it now.
//
// ⚠ AND NOTE WHAT THE FAIL-QUIET TEST PROVED THAT THE PRODUCER TESTS BELOW DO NOT. The consumer
// treated `"true"`, `1`, `false`, `null` and `undefined` identically — a near-miss flag fell back
// to the channel wording rather than naming a person. Below, main's half of that rule survives in
// full ("H2: main stamps `directChannel` ... and only then"): a non-`true` value means the field
// is ABSENT from the payload, so a consumer cannot mis-read a truthy string it never receives.
// The fail-quiet property is therefore still enforced, one layer earlier, by construction.

// ── main's half: WHERE that flag comes from, and that it can only ever be the server's ────

test("H2: main stamps `directChannel` on a DM session's post surface, and only then", () => {
  const mk = (direct) => ({
    profile: "full", channelId: "ch1", counterpartyName: "David", direct,
    state: { allowForTask: [], messageMode: "ask" },
    pendingPermissions: new Map(), pendingNames: new Map(),
  });
  const gated = (s) => {
    const evs = [];
    axisB.makeCanUseTool(s, (_s, ev) => evs.push(ev))(DOPL_CHANNEL_TOOL, { op: "send", body: "hi" },
      { requestId: "r1", toolUseID: "t1" });
    for (const id of s.pendingPermissions.keys()) s.pendingPermissions.get(id)({ behavior: "deny" });
    return evs[0].payload;
  };
  // A DM: the flag rides, alongside the name the consumer would have painted.
  const dm = gated(mk(true));
  assert.equal(dm.directChannel, true);
  assert.equal(dm.to, "David", "main's bound-counterparty fill is what gets named");
  // ⚠ REWRITTEN 2026-08-20: this line used to read the payload back through
  // `labels.postDestinationText(dm)` and assert "To: David". That formatter is deleted, so the
  // claim is now made where it is actually decided — on the payload that crosses the boundary.
  // INVARIANTS §11: assert the object that CROSSES, not the function that renders it.
  //
  // Anything else: the payload is byte-identical to the pre-H2 one — no stray field. This is the
  // FAIL-QUIET rule, and stamping it as an ABSENCE is what makes it un-mis-readable downstream:
  // a truthy-looking `"true"` never reaches a consumer to be believed.
  for (const direct of [false, undefined, "true", 1]) {
    const other = gated(mk(direct));
    assert.equal("directChannel" in other, false, JSON.stringify(direct));
    assert.equal(other.to, "David", "the bound-counterparty fill still happens; only the FLAG is withheld");
  }
});

// ── THE CARD NAMES A PERSON, NEVER A UUID (2026-08-06) ────────────────────────────
// Observed live: an agent addressed its counterparty BY USER ID — which the tool description
// actively invites ("an email or user id") and which the peer's own agent had handed over as a
// standing order — and the operator's card read `Sent to 2dac1943-da3b-4fd9-aee6-1716ddfc25f9`
// while the SERVER's echo of the same post said "addressed to Samuel Wang". Both call sites in
// session-io already documented the contract ("`to` is a display NAME"); `withPostSurface` was
// the one place that broke it, because `postAddress` returns the caller's argument verbatim.
// ⚠ This is a MAIN-side rule and it outlived the card it was named for: `to` is the display name
// on the payload, whoever paints it next.
test("the counterparty's id is resolved to their name before it leaves main", () => {
  const ID = "2dac1943-da3b-4fd9-aee6-1716ddfc25f9";
  const post = (input) =>
    io.withPostSurface({ type: "outbound_gate" }, input, "Samuel Wang", ID);

  // Addressed by ID -> the NAME rides the payload, and `addressed` still reports that the CALL
  // named someone (it is what a consumer branches "Sent to X" vs "Posted to channel" on).
  const byId = post({ op: "send", body: "hi", to: ID });
  assert.equal(byId.to, "Samuel Wang", "the raw user id reached the card");
  assert.equal(byId.addressed, true, "resolving the label must not un-address the post");

  // Addressed by NAME already -> unchanged.
  assert.equal(post({ op: "send", body: "hi", to: "Samuel Wang" }).to, "Samuel Wang");

  // UNADDRESSED -> the bound-counterparty fill, and NOT flagged as addressed. This is the
  // pre-existing behaviour the fix must not disturb.
  const bare = post({ op: "send", body: "hi" });
  assert.equal(bare.to, "Samuel Wang");
  assert.equal("addressed" in bare, false);

  // UUID CASING CARRIES NO MEANING (2026-08-07, found by audit). The first cut compared with
  // `===`, so an agent addressing by an uppercase uuid — which the tool description invites
  // and says nothing about casing — still painted the raw id, i.e. the exact symptom this
  // function exists to fix.
  assert.equal(post({ op: "send", body: "hi", to: ID.toUpperCase() }).to, "Samuel Wang");

  // A DIFFERENT member's id is LEFT VERBATIM rather than guessed at — this session knows one
  // counterparty and nothing else, and a wrong name is worse than an ugly id.
  const third = "33333333-3333-3333-3333-333333333333";
  assert.equal(post({ op: "send", body: "hi", to: third }).to, third);

  // No name to substitute -> the id stands. Never `null`, never "undefined".
  assert.equal(
    io.withPostSurface({ type: "outbound_gate" }, { op: "send", to: ID }, null, ID).to,
    ID
  );
});

test("H2: an AUTO-ALLOWED post carries the same destination fields as a gated one", () => {
  // Axis B auto_outbound resolves the record itself (session-outbound). If the flag rode only
  // the gated path, turning auto-send on would silently downgrade the record — the operator who
  // opted INTO hands-off sending would be the one who stopped being told where things went.
  const emitted = [];
  const s = { channelId: "ch1", counterpartyName: "David", direct: true };
  outbound.wrapGate(s, () => Promise.resolve({ behavior: "allow" }), (_s, ev) => emitted.push(ev))(
    DOPL_CHANNEL_TOOL, { op: "send", body: "hi" }, { toolUseID: "t1" });
  return new Promise((resolve) => setImmediate(() => {
    assert.equal(emitted[0].directChannel, true);
    // ⚠ REWRITTEN 2026-08-20: the two assertions here used to be
    // `labels.postDestinationText({...emitted[0], ownChannel: true}) === "To: David"` and
    // `render.outboundLabel(emitted[0]) === "Sent to David"`. Both formatters are deleted. The
    // property they were proving is that the auto path and the gated path emit the SAME fields,
    // so it is now asserted on the fields — which is also the stronger form, since it fails on a
    // divergence the two formatters happened to render identically.
    assert.equal(emitted[0].to, "David");
    resolve();
  }));
});

test("H2: the flag is read off the channel DTO and survives every session-start path", () => {
  // The responder path is the one that answers a DM, so it is the one whose card was wrong.
  // `counterpartyId` is NOT a substitute — a group thread binds one too (session-dispatch
  // passes `taskTarget`), and the server addresses nothing there.
  const src = readFileSync(M("trigger.js"), "utf8");
  assert.match(src, /direct: entry\.channel\.isDirect === true/,
    "the responder session must carry the server's own 1:1 flag, strictly compared");
  // And it survives a crash + resume: the resumed session posts too, and its record must not
  // quietly downgrade to "no recipient named" for the same DM.
  //
  // ⚠ REWRITTEN 2026-08-20 (F-228): this count was 3, for the three `startSession` specs
  // session-park.js used to hold. Two of them — `recreateParkedShell` and `openFromChannel` —
  // were shell factories and were deleted with the session window. `startResume` is the ONE
  // start path left in this file, so the count is 1. Keeping the literal 3 would have failed;
  // deleting the assertion would have lost the guard on the path that DID survive, which is the
  // one that actually posts after an interruption. The count stays asserted rather than softened
  // to /.test()/ because "at least one" is what let two of these drift apart in the first place.
  const park = readFileSync(M("session-park.js"), "utf8");
  assert.equal((park.match(/direct: (rec|ctx)\.direct === true/g) || []).length, 1,
    "the surviving startSession spec in session-park restores the flag");
  const engine = readFileSync(M("session-engine.js"), "utf8");
  assert.match(engine, /direct: spec\.direct === true/, "startSession binds it onto the session");
  assert.match(readFileSync(M("session-io.js"), "utf8"), /direct: s\.direct === true/,
    "and baseRecord persists it beside the counterparty binding");
});

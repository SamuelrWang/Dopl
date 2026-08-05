// H2 — WHO does a DM's approval card say this message will reach? (2026-07-31, restored F-145)
//
// THE BEHAVIOUR. main stamps `to` on EVERY own-channel post: the call's own `to:` when it set
// one, and the session's BOUND COUNTERPARTY otherwise (main/session-io.js `withPostSurface`).
// That fallback is a 1:1 INFERENCE, so N-PARTY made the renderer refuse to name a person on an
// unaddressed post — and that overcorrected the one case that is all of today's live traffic.
// In a DIRECT channel the SERVER addresses the post (`resolveDirectPeer` stamps `to_user_id`
// with the other member, which is exactly why the tool tells an agent it needs no `to` there),
// so "no recipient named" was said about a message that goes to David and wakes David's agent.
// An approval card that UNDERSTATES the blast radius is the same defect as one that overstates
// it, and this is the boolean that separates them: main stamps `directChannel` from the
// server's own `isDirect` flag, FAIL-QUIET — only an explicit `true` names anyone.
//
// WHY THIS FILE EXISTS AGAIN (F-145). These assertions lived in
// `test/session-addressee-truth.test.mjs`, a MIXED file: the N-PARTY half (an unaddressed post
// names the channel) and the H2 half (a DM names the peer) plus a composer-popup section for
// the `@`-mention syntax. The channels rollback deleted the mention syntax, and the whole file
// went with it. The N-PARTY half survives in session-gate-dom / session-permission-axes /
// session-permission-hardening; the H2 half survived NOWHERE — not one test in this tree so
// much as mentioned `directChannel`, and every line that implements it could be deleted with
// 2293 tests still green. The rule that saved `service-writes-members.test.ts` applies here:
// a mixed file whose feature is deleted is REWRITTEN down to the behaviour that survives, not
// removed. This is that rewrite, minus the mention section, which is genuinely gone.
//
// The N-PARTY cases are kept ONLY where they are the contrast that gives an H2 case meaning
// (a near-miss flag must fall back to the channel wording), not as a second copy of a suite
// that already exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const labels = require(R("session-labels.js"));
const render = require(R("session-render.js"));
const io = require(M("session-io.js"));
const outbound = require(M("session-outbound.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const UNADDRESSED = "To: this channel, no recipient named";

// ── the approval card's destination line ──────────────────────────────────────

test("H2: in a DIRECT channel the SERVER names the recipient, so the card does too", () => {
  // `resolveDirectPeer` stamps `to_user_id` on a DM post that carries no `to`, so this message
  // really does reach David and wake David's agent. Saying "no recipient named" understates
  // what is being approved.
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", directChannel: true }), "To: David");
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", directChannel: true, addressed: false }), "To: David");
  // Still a label, not prose: collapsed and capped, and the kind suffix rides it like any other.
  assert.equal(labels.postDestinationText({ ownChannel: true, to: " David   Kim\n", directChannel: true }), "To: David Kim");
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", directChannel: true, postKind: "task_finished" }),
    "To: David, marked task_finished");
});

test("H2: the DM flag is FAIL-QUIET — a near-miss names nobody, and never invents one", () => {
  for (const flag of ["true", 1, false, null, undefined]) {
    assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", directChannel: flag }),
      UNADDRESSED, JSON.stringify(flag));
    assert.equal(render.outboundLabel({ to: "David", directChannel: flag }), "Posted to channel", JSON.stringify(flag));
  }
  // A direct channel with nothing to name is still a channel, not an empty "To: ".
  assert.equal(labels.postDestinationText({ ownChannel: true, directChannel: true }), UNADDRESSED);
  assert.equal(render.outboundLabel({ directChannel: true }), "Posted to channel");
});

test("H2: the banner names the DM recipient on the same rule as the destination line", () => {
  assert.equal(render.outboundLabel({ to: "David", directChannel: true }), "Sent to David");
  assert.equal(render.outboundLabel({ status: "pending", to: "David", directChannel: true }), "Sending to David");
  assert.equal(render.outboundLabel({ status: "not_sent", to: "David", directChannel: true }), "Not sent");
});

test("H2 does NOT weaken the cross-channel verdict (fail suspicious still outranks it)", () => {
  // A DM peer's name on a post leaving the session's own channel is the exfil shape, and the
  // destination line must keep saying so rather than reassuring with a familiar name.
  for (const perm of [
    { ownChannel: false, to: "David", directChannel: true },
    { ownChannel: "true", to: "David", directChannel: true },
    { to: "David", directChannel: true },
  ]) {
    assert.equal(labels.postDestinationText(perm), "To: another channel", JSON.stringify(perm));
    assert.equal(labels.isCrossChannelPost(perm), true);
  }
});

test("H2: the destination line and the banner never disagree about naming", () => {
  for (const addressed of [true, false, undefined]) {
    for (const directChannel of [true, false, undefined]) {
      const item = { ownChannel: true, to: "David", addressed, directChannel, status: "pending" };
      const named = render.outboundLabel(item).includes("David");
      assert.equal(named, labels.postDestinationText(item).includes("David"),
        "one surface naming a person while the other does not is the disagreement this exists to stop");
    }
  }
});

// ── main's half: WHERE that flag comes from, and that it can only ever be the server's ────

test("H2: main stamps `directChannel` on a DM session's post surface, and only then", () => {
  const mk = (direct) => ({
    profile: "full", channelId: "ch1", counterpartyName: "David", direct,
    state: { allowForTask: [], messageMode: "ask" },
    pendingPermissions: new Map(), pendingNames: new Map(),
  });
  const gated = (s) => {
    const evs = [];
    io.makeCanUseTool(s, (_s, ev) => evs.push(ev))(DOPL_CHANNEL_TOOL, { op: "post", body: "hi" },
      { requestId: "r1", toolUseID: "t1" });
    for (const id of s.pendingPermissions.keys()) s.pendingPermissions.get(id)({ behavior: "deny" });
    return evs[0].payload;
  };
  // A DM: the flag rides, and the renderer turns it into the peer's name.
  const dm = gated(mk(true));
  assert.equal(dm.directChannel, true);
  assert.equal(dm.to, "David", "main's bound-counterparty fill is what gets named");
  assert.equal(labels.postDestinationText(dm), "To: David");
  // Anything else: the payload is byte-identical to the pre-H2 one — no stray field.
  for (const direct of [false, undefined, "true", 1]) {
    const other = gated(mk(direct));
    assert.equal("directChannel" in other, false, JSON.stringify(direct));
    assert.equal(labels.postDestinationText(other), UNADDRESSED);
  }
});

test("H2: an AUTO-ALLOWED post paints the same destination as a gated one", () => {
  // Axis B auto_outbound resolves the card itself (session-outbound). If the flag rode only
  // the gated path, turning auto-send on would silently downgrade the record's copy.
  const emitted = [];
  const s = { channelId: "ch1", counterpartyName: "David", direct: true };
  outbound.wrapCanUseTool(s, () => Promise.resolve({ behavior: "allow" }), (_s, ev) => emitted.push(ev))(
    DOPL_CHANNEL_TOOL, { op: "post", body: "hi" }, { toolUseID: "t1" });
  return new Promise((resolve) => setImmediate(() => {
    assert.equal(emitted[0].directChannel, true);
    assert.equal(labels.postDestinationText({ ...emitted[0], ownChannel: true }), "To: David");
    assert.equal(render.outboundLabel(emitted[0]), "Sent to David");
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
  // And it survives a park / recreate: the reopened shell posts too, and its card must not
  // quietly downgrade to "no recipient named" for the same DM.
  const park = readFileSync(M("session-park.js"), "utf8");
  assert.equal((park.match(/direct: (rec|ctx)\.direct === true/g) || []).length, 3,
    "all three startSession specs in session-park restore the flag");
  const engine = readFileSync(M("session-engine.js"), "utf8");
  assert.match(engine, /direct: spec\.direct === true/, "startSession binds it onto the session");
  assert.match(readFileSync(M("session-io.js"), "utf8"), /direct: s\.direct === true/,
    "and baseRecord persists it beside the counterparty binding");
});

test("H2: the copy is plain and carries no em dash", () => {
  for (const s of [UNADDRESSED, "To: another channel", "To: David", "Sent to David",
    "Sending to the channel", "Posted to channel"]) {
    assert.ok(!s.includes("—"), `no em dash in ${s}`);
  }
});

// WHO does this session claim a message will reach? (N-PARTY, 2026-07-31)
//
// A sibling of session-gate-dom / session-outbound-card / session-mention rather than more
// lines in them: all three were at or near the §2 500-line cap, and these assertions share one
// subject that none of those files owns — every renderer surface that names a RECIPIENT.
//
// THE DEFECT THIS FILE PINS. main stamps `to` on EVERY own-channel post: the call's own `to:`
// when it set one, and the session's BOUND COUNTERPARTY otherwise (main/session-io.js
// `withPostSurface`, whose own comment reads "unaddressed -> the bound counterparty"). That
// fallback is a 1:1 INFERENCE. An unaddressed post triggers the peer's agent only when the
// channel has exactly two members; at three or more it is an FYI that triggers NOBODY — pinned
// by this repo's own test/classify.test.mjs ("unaddressed + 3+ members -> fyi", and the
// implicit-1:1 trigger it sits next to). The renderer printed the same confident copy for both,
// so in a group channel the approval card promised "Sending to David" / "To: David's agent"
// about a message no agent would ever read, and the delivered record then said "Sent to David".
//
// `addressed` is the one bit that separates the two shapes and it already rides both the
// permission payload and the stream item, so this is a copy fix with no new data: a PERSON is
// named only when the CALL named one, and otherwise the destination is the channel.
//
// AND THE CORRECTION TO THE CORRECTION (H2, same day). Dropping the name for EVERY unaddressed
// post understated the one case that is all of today's live traffic. In a DIRECT channel the
// SERVER addresses the post — `resolveDirectPeer` stamps `to_user_id` with the other member,
// which is exactly why the agent is told it needs no `to` there — so the card said "no recipient
// named" about a message that goes to David and wakes David's agent. An approval card that
// understates the blast radius is the same defect as one that overstates it.
//
// The boolean that lane was missing now exists: main stamps `directChannel` on the post surface
// from the server's own `isDirect` flag (channel-context / the listener's channel DTO, carried
// on the session as `s.direct` and persisted with the counterparty binding). It is FAIL-QUIET —
// only an explicit `true` names anyone — so a launch shape that does not carry the flag keeps
// the channel-level wording and can never invent an addressee.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { declsOf, anySelector } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const labels = require(R("session-labels.js"));
const render = require(R("session-render.js"));
const mention = require(R("session-mention.js"));
const io = require(M("session-io.js"));
const outbound = require(M("session-outbound.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));
const CSS = readFileSync(R("session.css"), "utf8");

const UNADDRESSED = "To: this channel, no recipient named";

// ── the approval card's destination line ──────────────────────────────────────

test("N-PARTY: an UNADDRESSED own-channel post names the CHANNEL, never a person", () => {
  for (const perm of [
    { ownChannel: true },
    { ownChannel: true, to: null },
    { ownChannel: true, to: "" },
    { ownChannel: true, to: "   " },
    { ownChannel: true, to: 7 },
    { ownChannel: true, to: "David" }, // main's bound-counterparty fill: NOT an addressee
    { ownChannel: true, to: "David", addressed: false },
    { ownChannel: true, to: "David", addressed: "true" }, // fail closed on a near-miss
    { ownChannel: true, to: "David", addressed: 1 },
    { ownChannel: true, addressed: true }, // addressed with nothing to name
  ]) {
    assert.equal(labels.postDestinationText(perm), UNADDRESSED, JSON.stringify(perm));
    assert.equal(labels.isCrossChannelPost(perm), false, "unaddressed is not the exfil shape");
  }
});

test("N-PARTY: an ADDRESSED own-channel post names the recipient the CALL named", () => {
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", addressed: true }), "To: David");
  // MEDIUM-2: the addressee under decision may be a DIFFERENT member from this session's peer,
  // which is the whole reason naming it is worth doing at all.
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "evil@x.com", addressed: true }), "To: evil@x.com");
  // Still a label, not prose: collapsed and capped, and no newline can break it out of its line.
  assert.equal(labels.postDestinationText({ ownChannel: true, to: " David   Kim\n", addressed: true }), "To: David Kim");
  const long = labels.postDestinationText({ ownChannel: true, to: "D".repeat(200), addressed: true });
  assert.ok(long.length < 80 && long.startsWith("To: DDD") && long.endsWith("…") && !long.includes("\n"));
});

test("H2: in a DIRECT channel the SERVER names the recipient, so the card does too", () => {
  // `resolveDirectPeer` stamps `to_user_id` on a DM post that carries no `to` (the reason the
  // tool tells an agent it needs no `to` there), so this message really does reach David and
  // wake David's agent. Saying "no recipient named" understates what is being approved.
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", directChannel: true }), "To: David");
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", directChannel: true, addressed: false }), "To: David");
  // Still a label: collapsed, capped, and the kind suffix rides it like any other.
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

test("N-PARTY: the cross-channel verdict still outranks everything (fail suspicious)", () => {
  for (const perm of [{}, null, undefined, { ownChannel: "true" }, { ownChannel: 1 },
    { ownChannel: false, to: "David", addressed: true },
    // H2 does not weaken this: a DM's peer name on a post leaving the session's own channel
    // is the exfil shape, and the destination line must keep saying so.
    { ownChannel: false, to: "David", directChannel: true }]) {
    assert.equal(labels.postDestinationText(perm), "To: another channel", JSON.stringify(perm));
    assert.equal(labels.isCrossChannelPost(perm), true);
  }
});

test("N-PARTY: the forged-kind suffix rides BOTH lines (it is the louder half)", () => {
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", addressed: true, postKind: "task_finished" }),
    "To: David, marked task_finished");
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David", postKind: "task_finished" }),
    UNADDRESSED + ", marked task_finished");
});

// ── the same rule on the banner label (the card AND the delivered record) ──────

test("N-PARTY: outboundLabel names a person only on an ADDRESSED post", () => {
  assert.equal(render.outboundLabel({ to: "David", addressed: true }), "Sent to David");
  assert.equal(render.outboundLabel({ status: "pending", to: "David", addressed: true }), "Sending to David");
  assert.equal(render.outboundLabel({ to: "David" }), "Posted to channel", "no `addressed`, no name");
  assert.equal(render.outboundLabel({ status: "pending", to: "David" }), "Sending to the channel");
  assert.equal(render.outboundLabel({}), "Posted to channel");
  assert.equal(render.outboundLabel({ status: "pending" }), "Sending to the channel");
  // A stopped post claims nothing either way — the decision outranks the addressee.
  for (const a of [true, false, undefined]) {
    assert.equal(render.outboundLabel({ status: "not_sent", to: "David", addressed: a }), "Not sent");
  }
});

test("N-PARTY: the destination line and the banner never disagree about naming", () => {
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

test("H2: the RESPONDER spawn reads the flag off the channel DTO, not off the counterparty", () => {
  // The responder path is the one that answers a DM, so it is the one whose card was wrong.
  // `counterpartyId` is NOT a substitute for the flag — a group task binds one too
  // (session-dispatch passes `taskTarget`), and the server addresses nothing there.
  const src = readFileSync(M("trigger.js"), "utf8");
  const call = src.slice(src.indexOf("sessionEngine.launchResponderSession({"), src.indexOf("toolProfile: rec.toolProfile"));
  assert.match(call, /direct: entry\.channel\.isDirect === true/,
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

test("N-PARTY: the copy is plain and carries no em dash", () => {
  for (const s of [UNADDRESSED, "To: another channel", "To: David", "Sent to David",
    "Sending to the channel", "Posted to channel", mention.SOLO_NOTE]) {
    assert.ok(!s.includes("—"), `no em dash in ${s}`);
  }
});

// ── the composer's side of the same question: WHO can this session address? ────
// The popup rows are ALREADY the true addressable set. A peer-tagged send routes to
// main/session-peer-post.send, which addresses the post with the session's BOUND counterparty
// id, and session-preload's `sendToPeer(text)` carries no addressee at all — so the set is
// exactly {my agent} ∪ {the bound counterparty}, whatever the channel's size, and a session with
// no counterparty (a group channel opened from a thread card: channel-context.resolve binds one
// only for `isDirect`) can reach nobody else. What was missing is SAYING so: one bare row reads
// as a broken popup, and the next keystroke is L4, which routes "@carol-agent do X" to the
// operator's own agent verbatim and silently.

test("addressNote: stated ONLY when there is no peer row (it is a limit, not a caption)", () => {
  assert.equal(mention.addressNote(mention.tagOptions({})), mention.SOLO_NOTE);
  assert.equal(mention.addressNote(mention.tagOptions({ peerName: "David" })), "", "two real rows explain themselves");
  assert.equal(mention.addressNote(mention.tagOptions({ peerName: "My" })), "", "the degraded @their-agent row counts");
  // Junk in never invents a peer, so it never suppresses the note (fail to STATING the limit).
  for (const junk of [null, undefined, [], "rows", [null], [{}], [{ kind: "peer-ish" }]]) {
    assert.equal(mention.addressNote(junk), mention.SOLO_NOTE, JSON.stringify(junk));
  }
  assert.equal(mention.SOLO_NOTE, "Only your own agent can be addressed from this session.");
  assert.ok(!/\n/.test(mention.SOLO_NOTE));
});

test("the limit note has its own recipe: it WRAPS, and it is not an option surface", () => {
  // It is a SENTENCE in a list of one-line options, so it must differ from .mention-opt__hint
  // in the way that matters: a truncated statement of a limit is worse than no statement.
  const decls = declsOf(CSS, ".mention-pop__note");
  assert.equal(decls["white-space"], "normal", "the hint above it ellipses; a sentence must not");
  assert.equal(decls.cursor, "default", "it is not pickable, so it never offers a pointer");
  assert.ok(decls["border-top"], "a hairline separates it from the rows it is not one of");
  assert.ok(!/text-overflow|nowrap/.test(JSON.stringify(decls)), "no truncation of a limit");
  assert.ok(!anySelector(CSS, /\.mention-pop__note[^,{]*\.is-sel/), "never the selected-row surface");
});

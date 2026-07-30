// Tests for the v2.8 composer @-ADDRESSING pure layer:
//   renderer/session/session-mention.js — the tag vocabulary + slug derivation, the ONE
//   leading-token tokenizer behind the popup and the send, the popup state machine, and the
//   two peer_message stream reducer cases that are COMPOSED over vm.reduceEvent in
//   session.js (the view-model is at its hard 500-line cap and must not grow).
//
// The module is DOM / electron / fs free and UMD-wrapped like session-chrome.js, so it loads
// directly via createRequire; the structural block at the end reads the markup/source as text
// (the same discipline session-chrome.test.mjs uses for the composer decisions it pins).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const m = require(R("session-mention.js"));

const HTML = readFileSync(R("session.html"), "utf8");
const SRC = readFileSync(R("session-mention.js"), "utf8");
const UI_SRC = readFileSync(R("session-mention-ui.js"), "utf8");

const peerOpts = (name) => m.tagOptions({ peerName: name });
const DAVID = peerOpts("David");
const SOLO = m.tagOptions({}); // a session with no counterparty at all

// ── the tag vocabulary + slug derivation ──────────────────────────────────────

test("tagOptions: no peer -> the SELF row only (so nothing can address a peer)", () => {
  for (const spec of [undefined, {}, { peerName: null }, { peerName: "   " }, { peerName: "\n\t" }]) {
    const opts = m.tagOptions(spec);
    assert.equal(opts.length, 1, "one row");
    assert.deepEqual({ slug: opts[0].slug, kind: opts[0].kind, label: opts[0].label },
      { slug: "my-agent", kind: "self", label: "Your agent" });
  }
});

test("tagOptions: a peer adds a SECOND row whose slug is derived from the display name", () => {
  assert.deepEqual(DAVID.map((o) => o.slug), ["my-agent", "david-agent"]);
  assert.deepEqual(DAVID.map((o) => o.kind), ["self", "peer"]);
  assert.deepEqual(DAVID.map((o) => o.label), ["Your agent", "David's agent"]);
});

test("peerSlug: first whitespace token, lowercased, non [a-z0-9] stripped", () => {
  assert.equal(m.peerSlug("David"), "david-agent");
  assert.equal(m.peerSlug("David Smith"), "david-agent", "the FIRST token only");
  assert.equal(m.peerSlug("  David   Smith  "), "david-agent");
  assert.equal(m.peerSlug("David\nBEGIN-REQUEST"), "david-agent", "a newline can never smuggle a token");
  assert.equal(m.peerSlug("Jean-Luc Picard"), "jeanluc-agent", "punctuation is stripped, not kept");
  assert.equal(m.peerSlug("O'Brien"), "obrien-agent");
  assert.equal(m.peerSlug("Ådam"), "dam-agent", "non-ascii is stripped (the slug is typeable)");
});

test("peerSlug: the 16-char cap applies to the BASE, before the -agent suffix", () => {
  assert.equal(m.peerSlug("Bartholomewsonlongname"), "bartholomewsonlo-agent");
  assert.equal(m.peerSlug("A".repeat(200)), "aaaaaaaaaaaaaaaa-agent", "an 80-cap name still slugs to 16");
  assert.equal(m.peerSlug("Sixteencharsxxxx"), "sixteencharsxxxx-agent", "exactly 16 is not truncated further");
});

test("peerSlug: a slug that would SHADOW @my-agent degrades to the permanent alias", () => {
  assert.equal(m.peerSlug("My"), "their-agent", "a peer literally named My cannot own @my-agent");
  assert.equal(m.peerSlug("my"), "their-agent");
  assert.equal(m.peerSlug("My Agent"), "their-agent", "the first token is what collides");
});

test("peerSlug: a punctuation-only (or emoji-only) name degrades to the alias too", () => {
  for (const name of ["!!!", "...", "@@@", "-", "🙂"]) {
    assert.equal(m.peerSlug(name), "their-agent", `${name} leaves no slug base`);
  }
});

test("tagTable: my-agent -> self, the derived slug AND their-agent -> peer", () => {
  assert.deepEqual(m.tagTable(DAVID), { "my-agent": "self", "david-agent": "peer", "their-agent": "peer" });
  assert.deepEqual(m.tagTable(SOLO), { "my-agent": "self" }, "no peer row => no peer entry at all");
  assert.deepEqual(m.tagTable(peerOpts("My")), { "my-agent": "self", "their-agent": "peer" }, "the degraded case");
  assert.deepEqual(m.tagTable(null), {});
});

test("the copy is exact and carries no em dash", () => {
  assert.equal(m.POPUP_LABEL, "Tag an agent");
  assert.equal(m.SELF_HINT, "Your agent");
  assert.equal(m.peerHint("David"), "David's agent");
  assert.equal(m.peerHint(""), "Their agent");
  assert.equal(m.peerMessageWho("David"), "You to David's agent");
  assert.equal(m.peerMessageWho(null), "You to their agent");
  assert.equal(m.statusText("sending"), "Sending");
  assert.equal(m.statusText("sent"), "Sent");
  assert.equal(m.statusText("failed"), "Not sent");
  assert.equal(m.statusText(undefined), "Sending", "an unknown status reads as in flight");
  for (const s of [m.POPUP_LABEL, m.SELF_HINT, m.PEER_HINT_UNKNOWN, m.PEER_MSG_WHO_UNKNOWN,
    m.STATUS_SENDING, m.STATUS_SENT, m.STATUS_FAILED, m.peerHint("David"), m.peerMessageWho("David")]) {
    assert.ok(!s.includes("—"), `no em dash in ${s}`);
  }
});

// ── activeMention: LEADING-ONLY, with the caret inside the token ──────────────

test("activeMention: an @ at the start of the field IS a tag being typed", () => {
  assert.deepEqual(m.activeMention("@", 1), { start: 0, end: 1, query: "" });
  assert.deepEqual(m.activeMention("@d", 2), { start: 0, end: 2, query: "d" });
  assert.deepEqual(m.activeMention("@david-agent", 12), { start: 0, end: 12, query: "david-agent" });
  assert.deepEqual(m.activeMention("  @d", 4), { start: 2, end: 4, query: "d" }, "leading spaces are still leading");
  assert.deepEqual(m.activeMention("\t@d", 3), { start: 1, end: 3, query: "d" });
});

test("activeMention: an @ ANYWHERE else is inert (L1)", () => {
  assert.equal(m.activeMention("hi @d", 5), null);
  assert.equal(m.activeMention("hi\n@d", 5), null, "a second LINE is not the leading token");
  assert.equal(m.activeMention("x@d", 3), null);
  assert.equal(m.activeMention("do X", 4), null);
  assert.equal(m.activeMention("", 0), null);
  assert.equal(m.activeMention(null, 0), null);
});

test("FIX F5: a LEADING newline is leading whitespace, so the popup and the send agree", () => {
  // The defect: leadingToken skipped [ \t] only, so a draft starting with a newline routed to
  // the peer on send (session.js trims first) while the popup never opened once.
  assert.deepEqual(m.activeMention("\n@d", 3), { start: 1, end: 3, query: "d" });
  assert.deepEqual(m.activeMention("\n\n  @their-agent", 16), { start: 4, end: 16, query: "their-agent" });
  assert.deepEqual(m.activeMention("\r\n@d", 4), { start: 2, end: 4, query: "d" });
  assert.equal(m.activeMention("\n@d", 1), null, "the caret before the @ still closes it");
  // The caret math still keys on the REAL offsets, so applyMention edits the token in place.
  assert.deepEqual(m.applyMention("\n@d hi", { start: 1, end: 3 }, DAVID[1]),
    { value: "\n@david-agent hi", caret: 14 });
  // And what the popup offers is what a send delivers.
  assert.deepEqual(m.parseAddress("\n@their-agent hi", DAVID), { to: "peer", text: "hi" });
  assert.equal(m.hasPeerTag("\n@their-agent hi", DAVID), true);
  assert.equal(m.activeMention("hi\n@d", 5), null, "a SECOND line is still not the leading token");
});

test("activeMention: the caret must be INSIDE the token", () => {
  assert.equal(m.activeMention("@d ", 3), null, "typing past the token closes it");
  assert.equal(m.activeMention("@d hello", 8), null);
  assert.equal(m.activeMention("@d", 0), null, "the caret sits BEFORE the @");
  assert.deepEqual(m.activeMention("@david", 3), { start: 0, end: 6, query: "david" }, "mid-token still counts");
  // A non-numeric / absent caret reads as the end of the value (where a keystroke leaves it).
  assert.deepEqual(m.activeMention("@d"), { start: 0, end: 2, query: "d" });
  assert.deepEqual(m.activeMention("@d", NaN), { start: 0, end: 2, query: "d" });
  assert.deepEqual(m.activeMention("@d", 999), { start: 0, end: 2, query: "d" }, "an out-of-range caret clamps");
  assert.equal(m.activeMention("@d hello", -5), null, "a negative caret clamps to 0, before the @");
});

test("activeMention: a token contaminated by punctuation is NOT a tag", () => {
  for (const v of ["@foo.bar", "@my-agent,", "@my-agent!", "@d:"]) {
    assert.equal(m.activeMention(v, v.length), null, `${v} is inert`);
  }
});

// ── matchOptions ──────────────────────────────────────────────────────────────

test("FIX F6: the ALIAS is matchable, so a tag that WORKS is a tag that can be FOUND", () => {
  const slugs = (q) => m.matchOptions(DAVID, q).map((o) => o.slug);
  for (const q of ["t", "th", "the", "their", "their-agent", "THEIR"]) {
    assert.deepEqual(slugs(q), ["david-agent"], `"${q}" surfaces the peer row (it used to match nothing)`);
  }
  assert.deepEqual(DAVID[1].aliases, ["their-agent"], "the row carries the alias that addresses it");
  assert.deepEqual(DAVID[0].aliases, [], "the self row has no alias of its own");
  // Accepting still inserts the CANONICAL slug: one address on screen, the same bytes either way.
  assert.equal(m.applyMention("@th", { start: 0, end: 3 }, DAVID[1]).value, "@david-agent ");
  // An option with no aliases key at all (an older caller) must still match on slug + label.
  assert.equal(m.matchOptions([{ slug: "my-agent", label: "Your agent" }], "my").length, 1);
  assert.deepEqual(m.matchOptions([{ slug: "x-agent", label: "X", aliases: "their" }], "th"), [],
    "a junk aliases value is ignored, never iterated");
});

test("DO NOT FIX F7: a name with no slug base degrades to the alias, and the ROW SAYS SO", () => {
  for (const name of ["李雷", "🙂", "!!!"]) {
    const opts = m.tagOptions({ peerName: name });
    assert.equal(opts[1].slug, "their-agent", `${name}: the address IS the alias`);
    assert.equal(opts[1].label, name + "'s agent", "and the label still names the person");
    assert.deepEqual(opts[1].aliases, [], "no duplicate alias when the slug already is it");
    // Discoverable both ways: the row is on screen for a bare "@", and "th" matches its slug.
    assert.deepEqual(m.matchOptions(opts, "").map((o) => o.slug), ["my-agent", "their-agent"]);
    assert.deepEqual(m.matchOptions(opts, "th").map((o) => o.slug), ["their-agent"]);
  }
});

test("DO NOT FIX F13: a peer named My-Agent sorts NEXT TO self, and cannot hijack it", () => {
  const opts = m.tagOptions({ peerName: "My-Agent" });
  assert.deepEqual(opts.map((o) => o.slug), ["my-agent", "myagent-agent"], "no shadowing");
  assert.deepEqual(m.matchOptions(opts, "my").map((o) => o.slug), ["my-agent", "myagent-agent"]);
  assert.equal(m.matchOptions(opts, "my")[0].kind, "self", "self is ALWAYS index 0");
  // ...and index 0 is what a changed query highlights, so Enter still accepts my own agent.
  const st = m.reducePopup(m.initialPopup(), { type: "sync", value: "@my", caret: 3, options: opts });
  assert.equal(st.matches[st.index].slug, "my-agent");
  assert.equal(m.parseAddress("@my-agent do X", opts).to, "self");
});

test("matchOptions: case-insensitive PREFIX on the slug or on the hint", () => {
  const slugs = (q) => m.matchOptions(DAVID, q).map((o) => o.slug);
  assert.deepEqual(slugs(""), ["my-agent", "david-agent"], "an empty query shows both rows");
  assert.deepEqual(slugs("d"), ["david-agent"]);
  assert.deepEqual(slugs("DAV"), ["david-agent"], "ci on the slug");
  assert.deepEqual(slugs("david-agent"), ["david-agent"]);
  assert.deepEqual(slugs("my"), ["my-agent"]);
  assert.deepEqual(slugs("y"), ["my-agent"], "'Your agent' matches on the LABEL");
  assert.deepEqual(slugs("David"), ["david-agent"], "so does \"David's agent\"");
  assert.deepEqual(slugs("zz"), [], "an unknown prefix matches nothing (the popup closes)");
  assert.deepEqual(m.matchOptions(null, "d"), []);
});

// ── applyMention arithmetic ───────────────────────────────────────────────────

test("applyMention inserts '@slug ' and reports the caret after it", () => {
  const opt = DAVID[1];
  assert.deepEqual(m.applyMention("@d", { start: 0, end: 2 }, opt), { value: "@david-agent ", caret: 13 });
  assert.deepEqual(m.applyMention("@", { start: 0, end: 1 }, opt), { value: "@david-agent ", caret: 13 });
  assert.deepEqual(m.applyMention("@d", { start: 0, end: 2 }, DAVID[0]), { value: "@my-agent ", caret: 10 });
});

test("applyMention keeps the tail and absorbs exactly ONE following space", () => {
  const opt = DAVID[1];
  assert.deepEqual(m.applyMention("@d hello", { start: 0, end: 2 }, opt), { value: "@david-agent hello", caret: 13 });
  assert.deepEqual(m.applyMention("@d  hello", { start: 0, end: 2 }, opt), { value: "@david-agent  hello", caret: 13 },
    "a second space is the operator's, not ours");
  assert.deepEqual(m.applyMention("  @d x", { start: 2, end: 4 }, opt), { value: "  @david-agent x", caret: 15 });
  assert.deepEqual(m.applyMention("@d\nx", { start: 0, end: 2 }, opt), { value: "@david-agent \nx", caret: 13 },
    "a newline is never absorbed");
});

test("applyMention with nothing to apply is the identity", () => {
  assert.deepEqual(m.applyMention("@d", null, DAVID[1]), { value: "@d", caret: 2 });
  assert.deepEqual(m.applyMention("@d", { start: 0, end: 2 }, null), { value: "@d", caret: 2 });
});

// ── parseAddress: the ONE decision a send makes ───────────────────────────────

test("parseAddress: no tag at all addresses my agent with the text UNTOUCHED", () => {
  assert.deepEqual(m.parseAddress("do X", DAVID), { to: "self", text: "do X" });
  assert.deepEqual(m.parseAddress("", DAVID), { to: "self", text: "" });
});

test("L2: @my-agent is STRIPPED, byte-identical to sending the same words untagged", () => {
  assert.deepEqual(m.parseAddress("@my-agent do X", DAVID), { to: "self", text: "do X" });
  assert.equal(m.parseAddress("@my-agent do X", DAVID).text, m.parseAddress("do X", DAVID).text);
  assert.deepEqual(m.parseAddress("@my-agent   do X", DAVID), { to: "self", text: "do X" });
  assert.deepEqual(m.parseAddress("@my-agent\ndo X", DAVID), { to: "self", text: "do X" });
});

test("parseAddress: the derived slug AND the permanent alias both address the peer, ci", () => {
  for (const raw of ["@david-agent ship it", "@their-agent ship it", "@DAVID-AGENT ship it", "@Their-Agent ship it"]) {
    assert.deepEqual(m.parseAddress(raw, DAVID), { to: "peer", text: "ship it" }, raw);
  }
  assert.deepEqual(m.parseAddress("  @their-agent ship it", DAVID), { to: "peer", text: "ship it" });
});

test("L3: a tag with nothing after it delivers NOTHING (the send guard sees an empty text)", () => {
  assert.deepEqual(m.parseAddress("@their-agent", DAVID), { to: "peer", text: "" });
  assert.deepEqual(m.parseAddress("@my-agent", DAVID), { to: "self", text: "" });
  assert.deepEqual(m.parseAddress("@their-agent   ", DAVID), { to: "peer", text: "" });
});

test("L4: an UNRECOGNIZED tag is not a tag — the whole raw string goes to my agent", () => {
  assert.deepEqual(m.parseAddress("@zz-agent hi", DAVID), { to: "self", text: "@zz-agent hi" });
  assert.deepEqual(m.parseAddress("@david hi", DAVID), { to: "self", text: "@david hi" }, "close is not equal");
  assert.deepEqual(m.parseAddress("@my-agent.hi", DAVID), { to: "self", text: "@my-agent.hi" }, "contaminated token");
  assert.deepEqual(m.parseAddress("ship it @their-agent", DAVID), { to: "self", text: "ship it @their-agent" });
  assert.deepEqual(m.parseAddress("@", DAVID), { to: "self", text: "@" });
});

test("parseAddress can NEVER return peer on a session with no counterparty", () => {
  for (const raw of ["@their-agent hi", "@david-agent hi", "@my-agent hi", "hi"]) {
    assert.equal(m.parseAddress(raw, SOLO).to, "self", raw);
  }
  assert.deepEqual(m.parseAddress("@their-agent hi", SOLO), { to: "self", text: "@their-agent hi" }, "L4, not a peer post");
  assert.equal(m.parseAddress("@their-agent hi", null).to, "self", "no options at all is also self");
});

test("hasPeerTag: true only for a LEADING tag that resolves to the peer", () => {
  assert.equal(m.hasPeerTag("@their-agent ship it", DAVID), true);
  assert.equal(m.hasPeerTag("@david-agent ship it", DAVID), true);
  assert.equal(m.hasPeerTag("@their-agent", DAVID), true, "a bare peer tag still addresses the peer");
  assert.equal(m.hasPeerTag("\n@their-agent hi", DAVID), true, "the raw field value may carry stray whitespace");
  assert.equal(m.hasPeerTag("@my-agent ship it", DAVID), false);
  assert.equal(m.hasPeerTag("ship it @their-agent", DAVID), false);
  assert.equal(m.hasPeerTag("@zz-agent ship it", DAVID), false);
  assert.equal(m.hasPeerTag("", DAVID), false);
  assert.equal(m.hasPeerTag(null, DAVID), false);
  assert.equal(m.hasPeerTag("@their-agent ship it", SOLO), false, "no peer, no peer tag");
});

// ── the popup state machine ───────────────────────────────────────────────────

const sync = (st, value, caret) => m.reducePopup(st, { type: "sync", value, caret, options: DAVID });

test("initialPopup is closed and empty", () => {
  assert.deepEqual(m.initialPopup(), { open: false, query: "", start: 0, end: 0, matches: [], index: 0 });
});

test("reducePopup sync: an @ OPENS it with every match and the first row highlighted", () => {
  const st = sync(m.initialPopup(), "@", 1);
  assert.equal(st.open, true);
  assert.deepEqual(st.matches.map((o) => o.slug), ["my-agent", "david-agent"]);
  assert.equal(st.index, 0);
  assert.deepEqual([st.start, st.end, st.query], [0, 1, ""]);
});

test("reducePopup sync: narrowing keeps it open; an EMPTY match set closes it", () => {
  let st = sync(m.initialPopup(), "@d", 2);
  assert.deepEqual(st.matches.map((o) => o.slug), ["david-agent"]);
  st = sync(st, "@dz", 3);
  assert.deepEqual(st, m.initialPopup(), "no matches => closed, not an empty shell");
  assert.deepEqual(sync(m.initialPopup(), "hi @d", 5), m.initialPopup(), "a mid-text @ never opens it");
  assert.deepEqual(sync(m.initialPopup(), "do X", 4), m.initialPopup());
});

test("reducePopup sync: a CHANGED query resets the highlight, an unchanged one keeps it", () => {
  let st = sync(m.initialPopup(), "@", 1);
  st = m.reducePopup(st, { type: "move", delta: 1 });
  assert.equal(st.index, 1);
  const same = sync(st, "@", 1);
  assert.equal(same.index, 1, "the same query leaves the operator's highlight alone");
  const narrowed = sync(st, "@m", 2);
  assert.equal(narrowed.index, 0, "a new query starts from the top");
});

test("reducePopup move: wraps in both directions and no-ops while closed", () => {
  const open = sync(m.initialPopup(), "@", 1);
  assert.equal(m.reducePopup(open, { type: "move", delta: 1 }).index, 1);
  assert.equal(m.reducePopup(open, { type: "move", delta: -1 }).index, 1, "up from the first wraps to the last");
  const last = m.reducePopup(open, { type: "move", delta: 1 });
  assert.equal(m.reducePopup(last, { type: "move", delta: 1 }).index, 0, "down from the last wraps to the first");
  const closed = m.initialPopup();
  assert.equal(m.reducePopup(closed, { type: "move", delta: 1 }), closed, "identity while closed");
  assert.equal(m.reducePopup(open, { type: "move" }).index, 0, "a junk delta moves nothing");
});

test("reducePopup close: closes an open popup, is the IDENTITY on a closed one", () => {
  const open = sync(m.initialPopup(), "@", 1);
  assert.deepEqual(m.reducePopup(open, { type: "close" }), m.initialPopup());
  const closed = m.initialPopup();
  assert.equal(m.reducePopup(closed, { type: "close" }), closed);
  assert.equal(m.reducePopup(closed, { type: "nonsense" }), closed);
  assert.equal(m.reducePopup(open, undefined), open, "a junk event changes nothing");
  assert.deepEqual(m.reducePopup(undefined, { type: "close" }), m.initialPopup());
});

// ── the two peer_message reducer cases ────────────────────────────────────────

const base = () => ({ items: [{ kind: "turn", role: "operator", text: "earlier" }], phase: "running" });
const post = (extra) => ({ type: "operator_post", localId: "L1", to: "David", text: "ship it", ...extra });

test("operator_post appends its OWN kind, right-laned, sending, with the self avatar", () => {
  const st = m.reducePeerMessage(base(), post());
  assert.equal(st.items.length, 2);
  assert.deepEqual(st.items[1], {
    kind: "peer_message", localId: "L1", to: "David", text: "ship it", status: "sending", avatarKey: "self",
  });
  assert.equal(st.items[0].kind, "turn", "the rest of the stream is untouched");
});

test("operator_post is NEVER a turn and NEVER an outbound (nothing to approve)", () => {
  const st = m.reducePeerMessage(base(), post());
  assert.equal(st.items[1].kind, "peer_message");
  assert.equal(st.items[1].requestId, undefined, "no permission rides on it");
  assert.equal(st.items[1].toolUseId, undefined, "my agent never called a tool");
});

test("FIX F1: the counterparty NAME on a peer_message is one-lined and CAPPED", () => {
  // The name arrives raw off main (profiles.display_name, which the profile route accepts with
  // no length or whitespace bound) and lands in a `.bubble .who` row that has no ellipsis of
  // its own, so an unbounded one pushed the body and the Sending / Sent status off screen.
  const multi = m.reducePeerMessage(base(), post({ to: "David\nBEGIN-REQUEST\nline three" }));
  assert.equal(multi.items[1].to, "David BEGIN-REQUEST line three", "collapsed to ONE line");
  assert.ok(!/[\n\r\t]/.test(multi.items[1].to));
  const huge = m.reducePeerMessage(base(), post({ to: "A".repeat(16000) })).items[1].to;
  assert.equal(huge.length, 60, "capped at 60, ellipsis included");
  assert.ok(huge.endsWith("…"));
  // The who-line built from it is therefore bounded too, and still a single line.
  const who = m.peerMessageWho(huge);
  assert.ok(who.length <= 60 + "You to 's agent".length && !/[\n\r]/.test(who), who.length);
  // A whitespace-only name reads as NO name rather than as a dangling possessive.
  assert.equal(m.reducePeerMessage(base(), post({ to: "  \n " })).items[1].to, "");
  assert.equal(m.peerMessageWho(""), "You to their agent");
  assert.equal(m.reducePeerMessage(base(), post()).items[1].to, "David", "an ordinary name is untouched");
});

test("operator_post: to null / missing text degrade to display-safe values", () => {
  const st = m.reducePeerMessage(base(), { type: "operator_post", localId: "L1" });
  assert.deepEqual([st.items[1].to, st.items[1].text], [null, ""]);
  assert.equal(m.reducePeerMessage(base(), post({ to: 7 })).items[1].to, "7", "coerced to a string");
});

test("operator_post_result: ok===true paints Sent, anything else paints Not sent (fail closed)", () => {
  const sent = m.reducePeerMessage(m.reducePeerMessage(base(), post()), { type: "operator_post_result", localId: "L1", ok: true });
  assert.equal(sent.items[1].status, "sent");
  for (const ok of [false, undefined, null, 0, "true", 1, {}]) {
    const st = m.reducePeerMessage(m.reducePeerMessage(base(), post()), { type: "operator_post_result", localId: "L1", ok });
    assert.equal(st.items[1].status, "failed", `ok=${JSON.stringify(ok)} must not claim delivery`);
  }
});

test("operator_post_result resolves the FIRST still-sending item with that localId, once", () => {
  let st = m.reducePeerMessage(base(), post());
  st = m.reducePeerMessage(st, post({ localId: "L2", text: "and this" }));
  st = m.reducePeerMessage(st, { type: "operator_post_result", localId: "L1", ok: true });
  assert.deepEqual(st.items.map((it) => it.status), [undefined, "sent", "sending"]);
  // A second (or a late duplicate) verdict for the same id cannot re-stamp a settled bubble.
  const again = m.reducePeerMessage(st, { type: "operator_post_result", localId: "L1", ok: false });
  assert.equal(again, st, "identity: nothing left to resolve");
});

test("reducePeerMessage: an unknown type / localId is the IDENTITY", () => {
  const st = m.reducePeerMessage(base(), post());
  assert.equal(m.reducePeerMessage(st, { type: "turn", role: "operator", text: "x" }), st);
  assert.equal(m.reducePeerMessage(st, { type: "operator_post_result", localId: "nope", ok: true }), st);
  assert.equal(m.reducePeerMessage(st, { type: "operator_post" }), st, "no localId, no item");
  assert.equal(m.reducePeerMessage(st, { type: "operator_post_result", ok: true }), st);
  assert.equal(m.reducePeerMessage(st, null), st);
  assert.equal(m.reducePeerMessage(st, "nonsense"), st);
  assert.equal(m.reducePeerMessage(null, post()), null);
});

test("reducePeerMessage never MUTATES the state it is handed (deep-frozen)", () => {
  const deepFreeze = (o) => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
  };
  const frozen = deepFreeze(base());
  const posted = m.reducePeerMessage(frozen, post());
  assert.equal(frozen.items.length, 1, "the input array is untouched");
  assert.notEqual(posted, frozen);
  assert.notEqual(posted.items, frozen.items);
  const resolved = m.reducePeerMessage(deepFreeze(posted), { type: "operator_post_result", localId: "L1", ok: true });
  assert.equal(posted.items[1].status, "sending", "the input item is untouched");
  assert.equal(resolved.items[1].status, "sent");
  assert.notEqual(resolved.items[1], posted.items[1], "a NEW item object carries the new status");
});

// ── §10.7 structure: the pure block really is pure, the markup really is safe ──

test("the SESSION-MENTION-PURE block references no DOM, no electron, no require, no HTML", () => {
  const BEGIN = "// ─── BEGIN SESSION-MENTION-PURE";
  const END = "// ─── END SESSION-MENTION-PURE";
  const from = SRC.indexOf(BEGIN);
  const to = SRC.indexOf(END);
  assert.notEqual(from, -1, "BEGIN SESSION-MENTION-PURE sentinel missing");
  assert.notEqual(to, -1, "END SESSION-MENTION-PURE sentinel missing");
  assert.ok(to > from, "sentinels out of order");
  const BLOCK = SRC.slice(from, to);
  for (const banned of ["document", "electron", "require(", "innerHTML", "window", "process."]) {
    assert.ok(!BLOCK.includes(banned), `the pure block must not reference ${banned}`);
  }
});

test("session-mention.js touches no DOM AT ALL, and never builds markup", () => {
  assert.ok(!/document|innerHTML|insertAdjacentHTML|outerHTML/.test(SRC), "not even in a comment");
  assert.ok(!/require\('electron'\)|require\("electron"\)/.test(SRC));
  // The ONE dependency is the shared string formatter, and a missing one is a HARD error:
  // oneLine is what bounds the counterparty-controlled display name this module reads.
  assert.match(SRC, /require\("\.\/session-format\.js"\)/);
  assert.match(SRC, /throw new Error\("session-mention: session-format\.oneLine is required"\)/);
});

test("the DOM layer keeps the textContent-only posture (no innerHTML, no img.src of its own)", () => {
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(UI_SRC));
  assert.ok(!/\.src\s*=/.test(UI_SRC), "the ONLY avatar path is render.avatarNode (data: URI rule)");
  assert.match(UI_SRC, /render\.avatarNode\(/);
  assert.match(UI_SRC, /host\.replaceChildren\(/, "rows are rebuilt, never string-concatenated");
});

test("session.html loads the two modules in the ONE order that works", () => {
  const at = (f) => HTML.indexOf(`<script src="${f}"></script>`);
  for (const f of ["session-mention.js", "session-mention-ui.js"]) assert.notEqual(at(f), -1, `${f} is loaded`);
  assert.ok(at("session-format.js") < at("session-mention.js"), "the pure layer reads session-format");
  assert.ok(at("session-render.js") < at("session-mention-ui.js"), "the DOM layer reads session-render");
  assert.ok(at("session-chrome.js") < at("session-mention-ui.js"), "...and session-chrome (the lane)");
  assert.ok(at("session-mention.js") < at("session-mention-ui.js"), "the DOM layer reads the pure layer");
  assert.ok(at("session-mention-ui.js") < at("session.js"), "both are loaded BEFORE the controller");
});

test("the popup node is an empty ARIA listbox, and the field is its combobox", () => {
  assert.match(HTML, /<div class="mention-pop hidden" id="mentionPop" role="listbox" aria-label="Tag an agent"><\/div>/);
  const ta = HTML.slice(HTML.indexOf('<textarea class="steer-input"'), HTML.indexOf("composer__controls"));
  assert.match(ta, /role="combobox"/);
  assert.match(ta, /aria-controls="mentionPop"/);
  assert.match(ta, /aria-expanded="false"/, "closed at rest; session-mention-ui.js flips it");
  assert.match(ta, /aria-autocomplete="list"/);
  assert.ok(!/placeholder/.test(ta), "D6 survives: still no placeholder on the steer field");
});

test("the v2.8 markup introduces no asset, no label text, and does not touch the CSP", () => {
  assert.ok(!/<img/.test(HTML), "no image asset (the CSP allows only self + data:)");
  assert.ok(!/>Send</.test(HTML), "the send button is still an icon button");
  assert.match(HTML, /default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none';/);
});

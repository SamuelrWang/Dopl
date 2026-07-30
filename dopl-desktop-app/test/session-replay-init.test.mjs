// C5 (renderer H1) — the replay ring must never lose the window's IDENTITY.
//
// THE BUG, in two halves.
//  1. The ring is bounded at 1MB and drops OLDEST-FIRST, and `init` is always entry 0 — so
//     `init` was the FIRST thing evicted under pressure.
//  2. `init` itself carried the two avatar `data:` URIs (avatar-cache caps each assembled URI
//     at ~350KB), so a single cold-cache fill could blow that 1MB bound on its own.
// After a Cmd-R reload the renderer replays the ring into a fresh fold. With `init` gone the
// window came back without its peer name, channel and task title — AND the composer's @-tag
// reads `state.init.from` (renderer/session/session.js getPeerName), so a tag silently
// addressed the operator's own agent instead of the peer.
//
// THE FIX: `init` is a STICKY HEAD the ring may never evict, and the avatars are split onto
// the `avatars` event, which the view-model already OR-merges (`null` means keep what you
// have). Both live in main/session-replay.js: the pure ring block is sliced and evaluated
// verbatim, and createReplay is required directly (it imports nothing electron-bound).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-replay.js"), "utf8");
const { createReplay } = require(join(HERE, "..", "main", "session-replay.js"));

const BEGIN = "// ─── BEGIN SESSION-REPLAY-RING";
const END = "// ─── END SESSION-REPLAY-RING";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.ok(from !== -1 && to > from, "SESSION-REPLAY-RING sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

const ring = new Function(
  `${BLOCK}\n return { createRing, ringRecord, ringDrain, ringOnLoad, ringOnReload, stickyHead, splitInitAvatars };`
)();

const INIT = { type: "init", sessionId: "s1", from: "David", channelName: "Ops", taskTitle: "Ship it" };
const big = (n) => ({ type: "turn", text: "x".repeat(n) });
// The real shape: avatar-cache assembles a data: URI up to MAX_URI_LEN (~350KB).
const AV = "data:image/png;base64," + "A".repeat(350 * 1024);

// ── the sticky head ────────────────────────────────────────────────────────────

test("C5: `init` survives a byte-cap eviction storm; the entries after it go instead", () => {
  const r = ring.createRing(100, 4000);
  ring.ringRecord(r, INIT);
  for (let i = 0; i < 20; i += 1) ring.ringRecord(r, big(500));
  assert.equal(r.entries[0].type, "init", "the identity entry is pinned");
  assert.deepEqual(r.entries[0], INIT, "and it is the SAME payload, untouched");
  assert.ok(r.entries.length < 21, "the ring really did evict (this is a live bound, not a no-op)");
  assert.ok(r.bytes <= 4000 + JSON.stringify(INIT).length + 500, "and it still respects its bound");
});

test("C5: the ENTRY cap evicts around the sticky head too", () => {
  const r = ring.createRing(4, 1e9);
  ring.ringRecord(r, INIT);
  for (const t of ["a", "b", "c", "d", "e", "f"]) ring.ringRecord(r, { type: "turn", text: t });
  assert.equal(r.entries[0].type, "init");
  assert.equal(r.entries.length, 4);
  assert.deepEqual(r.entries.slice(1).map((e) => e.text), ["d", "e", "f"], "the newest turns survive");
});

test("C5: with NO init at the head, drop-oldest is unchanged (F-08a behavior)", () => {
  const r = ring.createRing(3, 1e9);
  for (const t of ["a", "b", "c", "d"]) ring.ringRecord(r, { type: "turn", text: t });
  assert.deepEqual(r.entries.map((e) => e.text), ["b", "c", "d"]);
  assert.equal(ring.stickyHead(r), 0, "nothing is pinned when the head is not an init");
});

test("C5: the sent cursor still tracks the sent/unsent boundary across a pinned eviction", () => {
  const r = ring.createRing(100, 1e9);
  ring.ringRecord(r, INIT);
  for (const t of ["a", "b", "c"]) ring.ringRecord(r, { type: "turn", text: t });
  ring.ringDrain(r); // everything sent
  assert.equal(r.sentIdx, 4);
  r.maxEntries = 3;
  ring.ringRecord(r, { type: "turn", text: "d" }); // evicts "a" (index 1), not the init
  assert.equal(r.sentIdx, r.entries.length - 1, "only the NEW entry is unsent");
  assert.deepEqual(ring.ringDrain(r).map((e) => e.text), ["d"]);
});

test("C5: a reload replays the identity — which is what the @-tag reads", () => {
  const r = ring.createRing(100, 3000);
  ring.ringRecord(r, INIT);
  for (let i = 0; i < 30; i += 1) ring.ringRecord(r, big(400));
  ring.ringOnReload(r);
  const replayed = ring.ringOnLoad(r);
  assert.equal(replayed[0].type, "init", "the fold rebuilds state.init, so init.from is the peer again");
  assert.equal(replayed[0].from, "David");
});

// ── the avatars never ride init ────────────────────────────────────────────────

test("C5: an init carrying avatars is split into a small init + an `avatars` event", () => {
  const out = ring.splitInitAvatars({ ...INIT, selfAvatar: AV, fromAvatar: AV });
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "init");
  assert.equal(out[0].selfAvatar, null, "the URIs are OFF the identity entry");
  assert.equal(out[0].fromAvatar, null);
  assert.equal(out[0].from, "David", "everything else is preserved verbatim");
  assert.deepEqual(out[1], { type: "avatars", self: AV, from: AV }, "the OR-merge event carries them");
  assert.ok(JSON.stringify(out[0]).length < 1024, "and init is now small enough to pin forever");
});

test("C5: an init without avatars, and every other payload, passes straight through", () => {
  assert.deepEqual(ring.splitInitAvatars(INIT), [INIT]);
  const turn = { type: "turn", text: "hi" };
  assert.deepEqual(ring.splitInitAvatars(turn), [turn]);
  assert.deepEqual(ring.splitInitAvatars(null), [null]);
  // A one-sided fill still splits (the missing side stays null, so the OR-merge keeps it).
  const one = ring.splitInitAvatars({ ...INIT, fromAvatar: AV });
  assert.deepEqual(one[1], { type: "avatars", self: null, from: AV });
});

test("C5 end to end: two 350KB avatars can no longer evict the identity", () => {
  const sent = [];
  const replay = createReplay({ isDestroyed: () => false }, (p) => sent.push(p));
  replay.onLoad();
  replay.deliver({ ...INIT, selfAvatar: AV, fromAvatar: AV });
  assert.deepEqual(sent.map((p) => p.type), ["init", "avatars"], "the live window got both, separately");
  assert.equal(sent[0].selfAvatar, null, "with no data: URI weighing the identity down");
  for (let i = 0; i < 40; i += 1) replay.deliver(big(20 * 1024)); // ~800KB of transcript
  replay.onReload();
  sent.length = 0;
  replay.onLoad();
  assert.equal(sent[0].type, "init", "the reloaded window still knows who it is talking to");
  assert.equal(sent[0].from, "David", "so an @-tag still addresses the peer, not the operator's own agent");
  // The DELIBERATE trade-off: an evicted `avatars` entry only costs a photo (the renderer
  // falls back to initials). Identity is what must never be evictable.
  assert.ok(sent.every((p) => p.type !== "init" || p.selfAvatar == null));
});

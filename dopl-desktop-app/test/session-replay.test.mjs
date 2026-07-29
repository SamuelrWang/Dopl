// Tests for the v2.1 transcript replay (main/session-replay.js, Track T2, item 3).
//
// TWO layers:
//   1. SOURCE EXTRACTION — the BEGIN/END SESSION-REPLAY-RING block is the pure ring
//      core (no electron/fs/SDK refs, §H-7). We slice it and evaluate it verbatim to
//      test the cursor + drop-oldest semantics with an INJECTABLE cap, so the ring can
//      never drift from what ships.
//   2. DIRECT REQUIRE — session-replay.js imports nothing electron-bound, so we require
//      createReplay in plain Node and exercise the FROZEN seam (§B.4) with a fake
//      webContents + a recording sendFn: first-load flush, live delivery, and the reload
//      re-send that is the entire bug fix.
//
// The reload story in one line: a reload is NEITHER close nor crash, so the session
// survives; onReload rewinds the cursor and onLoad re-sends the whole transcript, which
// the renderer's pure fold replays into identical state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-replay.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-REPLAY-RING";
const END = "// ─── END SESSION-REPLAY-RING";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-REPLAY-RING sentinel missing");
assert.notEqual(to, -1, "END SESSION-REPLAY-RING sentinel missing");
assert.ok(to > from, "session-replay ring sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The sliced ring core must stay electron/fs/path/SDK/require-free (§H-7). Scan CODE
// only (strip // comments — they legitimately name electron/fs to say "free of them").
const CODE = BLOCK.split("\n").map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); }).join("\n");
for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!CODE.includes(banned), `SESSION-REPLAY-RING block must not reference ${banned}`);
}

const { createRing, ringRecord, ringDrain, ringOnLoad, ringOnReload } = new Function(
  `${BLOCK}\n return { createRing, ringRecord, ringDrain, ringOnLoad, ringOnReload };`
)();

// ── ring core: cursor semantics ────────────────────────────────────────────────

test("createRing starts empty, unloaded, cursor at 0", () => {
  const ring = createRing();
  assert.deepEqual(ring.entries, []);
  assert.equal(ring.sentIdx, 0);
  assert.equal(ring.loaded, false);
});

test("record before load buffers; onLoad flushes everything and advances the cursor", () => {
  const ring = createRing();
  ringRecord(ring, { type: "init" });
  ringRecord(ring, { type: "turn" });
  assert.equal(ring.sentIdx, 0, "nothing sent before the first load");
  const flushed = ringOnLoad(ring);
  assert.deepEqual(flushed, [{ type: "init" }, { type: "turn" }]);
  assert.equal(ring.loaded, true);
  assert.equal(ring.sentIdx, 2, "cursor now at the end — all seen");
});

test("after load, ringDrain returns only the not-yet-seen tail", () => {
  const ring = createRing();
  ringRecord(ring, { type: "init" });
  ringOnLoad(ring); // cursor -> 1
  ringRecord(ring, { type: "tool_use" });
  ringRecord(ring, { type: "tool_result" });
  const tail = ringDrain(ring);
  assert.deepEqual(tail, [{ type: "tool_use" }, { type: "tool_result" }]);
  assert.equal(ring.sentIdx, 3);
});

test("onReload rewinds: the WHOLE transcript re-sends on the next onLoad (the fix)", () => {
  const ring = createRing();
  for (const p of [{ type: "init" }, { type: "turn" }, { type: "status" }]) ringRecord(ring, p);
  ringOnLoad(ring); // first load flushes all three; cursor -> 3
  assert.equal(ring.sentIdx, 3);
  ringOnReload(ring); // Cmd-R: renderer reset to initialState
  assert.equal(ring.loaded, false);
  assert.equal(ring.sentIdx, 0, "cursor rewound so nothing counts as seen");
  const replayed = ringOnLoad(ring);
  assert.deepEqual(replayed, [{ type: "init" }, { type: "turn" }, { type: "status" }], "the whole log re-sends");
});

// ── ring core: bounded drop-oldest ─────────────────────────────────────────────

test("entry cap drops the OLDEST; an already-sent drop decrements the cursor", () => {
  const ring = createRing(3, 1e9); // cap 3 entries, byte cap effectively off
  ringRecord(ring, { n: 1 });
  ringRecord(ring, { n: 2 });
  ringOnLoad(ring); // sent {1},{2}; cursor -> 2
  assert.equal(ring.sentIdx, 2);
  ringRecord(ring, { n: 3 });
  ringRecord(ring, { n: 4 }); // length 4 > cap 3 -> drop {1} (a SENT entry)
  assert.equal(ring.entries.length, 3);
  assert.deepEqual(ring.entries, [{ n: 2 }, { n: 3 }, { n: 4 }]);
  assert.equal(ring.sentIdx, 1, "cursor decremented so {2} still counts as sent, {3}/{4} are the unseen tail");
  const tail = ringDrain(ring);
  assert.deepEqual(tail, [{ n: 3 }, { n: 4 }], "only the genuinely-unseen tail flushes");
});

test("byte cap also evicts oldest but keeps at least one entry", () => {
  const big = "x".repeat(500);
  const ring = createRing(1e9, 800); // ~800 byte cap
  ringRecord(ring, { a: big });
  ringRecord(ring, { b: big }); // two ~500B entries exceed 800 -> oldest evicted
  assert.equal(ring.entries.length, 1);
  assert.deepEqual(ring.entries[0], { b: big });
});

test("dropping an UNSENT entry never pushes the cursor below 0 (bounded loss, F-08a)", () => {
  const ring = createRing(2, 1e9);
  ringRecord(ring, { n: 1 });
  ringRecord(ring, { n: 2 });
  ringRecord(ring, { n: 3 }); // drop {1} while nothing sent yet -> sentIdx stays 0
  assert.equal(ring.sentIdx, 0);
  const flushed = ringOnLoad(ring);
  assert.deepEqual(flushed, [{ n: 2 }, { n: 3 }], "the earliest entry is lost, the rest replay");
});

// ── createReplay seam (§B.4) — first-load flush + reload re-send ────────────────

const replay = require(join(HERE, "..", "main", "session-replay.js"));

// A fake webContents whose isDestroyed() we can flip; a sendFn that records sends.
function harness({ destroyed = false } = {}) {
  const sent = [];
  const wc = { isDestroyed: () => destroyed };
  const r = replay.createReplay(wc, (p) => sent.push(p));
  return { r, sent, wc };
}

test("createReplay: deliver before load buffers; onLoad flushes in order", () => {
  const { r, sent } = harness();
  r.deliver({ type: "init" });
  r.deliver({ type: "folder", label: "~/Downloads" });
  assert.deepEqual(sent, [], "nothing crosses before the first load");
  assert.equal(r.loaded, false);
  r.onLoad();
  assert.deepEqual(sent, [{ type: "init" }, { type: "folder", label: "~/Downloads" }]);
  assert.equal(r.loaded, true);
});

test("createReplay: after load, deliver sends immediately", () => {
  const { r, sent } = harness();
  r.onLoad();
  r.deliver({ type: "turn", text: "hi" });
  assert.deepEqual(sent, [{ type: "turn", text: "hi" }]);
});

test("createReplay: a reload re-sends the ENTIRE transcript (item 3 core)", () => {
  const { r, sent } = harness();
  r.deliver({ type: "init" });
  r.onLoad(); // first load
  r.deliver({ type: "turn" });
  r.deliver({ type: "status", activity: "idle" });
  assert.equal(sent.length, 3);
  // Cmd-R: did-start-loading then did-finish-load.
  r.onReload();
  assert.equal(r.loaded, false);
  r.onLoad();
  assert.deepEqual(sent.slice(3), [
    { type: "init" },
    { type: "turn" },
    { type: "status", activity: "idle" },
  ], "the whole conversation replays so the renderer's fold rebuilds it");
});

test("createReplay: a destroyed webContents drops sends silently (no throw)", () => {
  const { r, sent } = harness({ destroyed: true });
  r.deliver({ type: "init" });
  r.onLoad();
  assert.deepEqual(sent, [], "a destroyed window never receives");
});

test("createReplay exposes the FROZEN seam shape", () => {
  const { r } = harness();
  for (const m of ["deliver", "record", "onLoad", "onReload"]) {
    assert.equal(typeof r[m], "function", `seam must expose ${m}()`);
  }
  assert.equal(typeof r.loaded, "boolean", "seam must expose a loaded flag");
});

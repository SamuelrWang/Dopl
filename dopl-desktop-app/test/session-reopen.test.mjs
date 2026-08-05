// Tests for the session-reopen helpers (main/session-reopen.js) — the MAIN-window
// "Open session" bridge (item 2) and its v1.7.4 P2 fallback. The behaviour that this
// bridge starts NOTHING is pinned separately in test/open-session-no-query.test.mjs.
//
// SOURCE EXTRACTION with INJECTION (the session-dispatch idiom): the BEGIN/END
// SESSION-REOPEN-PURE block references `store` (a module require) as a free var and
// declares its own `deps` (set by bind). We slice the block, prove it is
// electron/require-free, inject a fake `store`, and bind fake engine internals to pin:
//   a LIVE session shows its window; NO live session falls back to recreateParkedShell;
//   the fallback is skipped (returns {ok:false}) when the engine did not wire it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-reopen.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-REOPEN-PURE";
const END = "// ─── END SESSION-REOPEN-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-REOPEN-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-REOPEN-PURE sentinel missing");
assert.ok(to > from, "session-reopen sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-REOPEN-PURE block must not reference ${banned}`);
}

const KEY = "chan-1:task-9";

// A fake live-window session; records show()/focus() calls.
function fakeSession(over = {}) {
  const calls = { show: 0, focus: 0 };
  const win = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    show() { calls.show++; },
    focus() { calls.focus++; },
  };
  return { key: KEY, sessionId: "s-1", settled: false, windowHidden: true, win, context: {}, calls, ...over };
}

function harness(over = {}) {
  const cfg = { record: null, sdkId: null, recreate: null, ...over };
  const calls = { refreshTray: 0, recreate: [] };
  const store = { sessionKey: (c, t) => `${c}:${t}` };
  const api = new Function(
    "store",
    `${BLOCK}\n return { bind, showLive, listLiveSessions, reopenWindow, reopenByTask };`
  )(store);
  const sessions = new Map();
  const refreshTray = () => { calls.refreshTray++; };
  const recreateParkedShell = cfg.recreate
    ? (a) => { calls.recreate.push(a); return cfg.recreate(a); }
    : null;
  // §3.3: the ENDED-but-kept window lookup (main/session-summary.keptWindow). Null unless a
  // case arms one, which is also the mid-wave shape (an engine that has not wired it).
  const keptWindow = cfg.kept ? () => cfg.kept : null;
  api.bind({ sessions, refreshTray, recreateParkedShell, keptWindow });
  return { ...api, sessions, calls };
}

const task = { channelId: "chan-1", taskId: "task-9" };

// ── reopen a live (parked) session shows its window ──────────────────────────────

test("reopenByTask shows the window of a LIVE (parked) session (no fallback)", () => {
  const h = harness({ recreate: () => ({ ok: true }) });
  const s = fakeSession();
  h.sessions.set(KEY, s);
  const r = h.reopenByTask(task);
  assert.deepEqual(r, { ok: true });
  assert.equal(s.calls.show, 1, "the surviving window is shown");
  assert.equal(s.calls.focus, 1);
  assert.equal(s.windowHidden, false, "the hidden flag is cleared");
  assert.equal(h.calls.recreate.length, 0, "a live session never triggers the fallback");
});

// ── P2 fallback: no live session -> recreate a parked shell ───────────────────────

test("P2 fallback: no live session delegates to recreateParkedShell", async () => {
  const h = harness({ recreate: () => ({ ok: true }) });
  const r = await h.reopenByTask(task);
  assert.deepEqual(r, { ok: true });
  assert.equal(h.calls.recreate.length, 1);
  // Q6b: the CLICK marker — only this caller may build a shell for a thread with no local record.
  assert.deepEqual(h.calls.recreate[0], { channelId: "chan-1", taskId: "task-9", fromChannel: true });
});

test("P2 fallback: recreateParkedShell can return {ok:false} for a truly-closed task", async () => {
  const h = harness({ recreate: () => ({ ok: false }) });
  const r = await h.reopenByTask(task);
  assert.deepEqual(r, { ok: false });
  assert.equal(h.calls.recreate.length, 1);
});

test("no live session AND no fallback bound -> {ok:false} (mid-wave safety)", () => {
  const h = harness({ recreate: null });
  assert.deepEqual(h.reopenByTask(task), { ok: false });
});

test("a settled or destroyed session falls through to the fallback (not shown)", async () => {
  const h = harness({ recreate: () => ({ ok: true }) });
  const s = fakeSession({ settled: true });
  h.sessions.set(KEY, s);
  const r = await h.reopenByTask(task);
  assert.deepEqual(r, { ok: true });
  assert.equal(s.calls.show, 0, "a settled session is never shown");
  assert.equal(h.calls.recreate.length, 1, "it falls back to recreate");
});

// ── §3.3: the ENDED session whose window survived ────────────────────────────────

// An ABANDONED session settles out of the registry with its window LEFT OPEN (M2b: an end
// nobody watched happen must not make a transcript vanish). Its session pill stays, as
// `ended`, and clicking Open must land in THAT transcript.
function keptWin() {
  const win = {
    destroyed: false,
    shown: 0,
    focused: 0,
    isDestroyed() { return this.destroyed; },
    show() { this.shown++; },
    focus() { this.focused++; },
  };
  return win;
}

test("an ENDED session's kept window is shown, and the recreate is NOT reached", async () => {
  const win = keptWin();
  const h = harness({ kept: win, recreate: () => ({ ok: true }) });
  const r = await h.reopenByTask(task);
  assert.deepEqual(r, { ok: true });
  assert.equal(win.shown, 1, "the painted transcript the abandonment left behind is revealed");
  assert.equal(win.focused, 1);
  assert.equal(
    h.calls.recreate.length,
    0,
    "recreating here would open a FRESH parked shell — a different session wearing the " +
      "dead one's name, over the top of the transcript the operator was trying to read"
  );
});

test("a LIVE session still wins over a kept one for the same slot", () => {
  const win = keptWin();
  const h = harness({ kept: win, recreate: () => ({ ok: true }) });
  const s = fakeSession();
  h.sessions.set(KEY, s);
  assert.deepEqual(h.reopenByTask(task), { ok: true });
  assert.equal(s.calls.show, 1);
  assert.equal(win.shown, 0, "the live session is the one the pill should open");
});

test("a kept window the operator CLOSED falls through to the recreate", async () => {
  const win = keptWin();
  win.destroyed = true;
  const h = harness({ kept: win, recreate: () => ({ ok: true }) });
  const r = await h.reopenByTask(task);
  assert.deepEqual(r, { ok: true });
  assert.equal(win.shown, 0);
  assert.equal(h.calls.recreate.length, 1, "nothing is left to reveal — this is a plain reopen");
});

test("an unwired keptWindow changes nothing (mid-wave engine)", async () => {
  const h = harness({ recreate: () => ({ ok: true }) });
  const r = await h.reopenByTask(task);
  assert.deepEqual(r, { ok: true });
  assert.equal(h.calls.recreate.length, 1);
});

test("reopenWindow shows a hidden live window by internal sessionId", () => {
  const h = harness();
  const s = fakeSession({ sessionId: "internal-7" });
  h.sessions.set(KEY, s);
  assert.equal(h.reopenWindow("internal-7"), true);
  assert.equal(s.calls.show, 1);
  assert.equal(h.reopenWindow("nope"), false);
});

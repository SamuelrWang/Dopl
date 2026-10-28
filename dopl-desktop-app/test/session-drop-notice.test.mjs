// THE DROP REPORT (#3201). Two silences this covers, both measured in channel bb0f57db on
// 2026-10-10 before the fix existed:
//   `viloxuwt` ran 7 minutes, posted NOTHING, parked on turn end, reaped 12h later.
//   `jsk2zowk` posted a MILESTONE with two tests still failing, parked, reaped 12h later, no DONE.
// Each wrote one `thread_progress` lifecycle marker, which addresses nobody and names no agent, so
// the launcher went on waiting. These pin the two halves of the fix: the REDUCER deciding a park
// reported nothing (from state alone), and the EXECUTOR's pure text/last-activity helpers.
//
// Same source-extraction idiom as the reducer suites for the pure block; the executor's own
// module is required directly, because `report` is deliberately impure (banner + post).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";

const require = createRequire(import.meta.url);
const { initialSessionState, sessionReducer, parkNoticeFor, endNoticeFor,
        DROP_PARKED_SILENT, DROP_ENDED, INACTIVE_NOTE } = loadReducer();
const notice = require("../main/session-drop-notice.js");

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const findEff = (effects, type) => effects.find((e) => e.type === type);

// ── the reducer half: which parks report ─────────────────────────────────────────

// ⚠ THE BUG THIS PINS IS AN ORDERING ONE. `result` clears `postedThisTurn` the instant the turn
// ends and folds the answer into `activity`; the idle timer fires minutes later. A `parkNoticeFor`
// that read the flag would call every park silent, which is worse than the silence it replaces.
test("a turn that POSTED parks with no report (activity carries the answer, not the flag)", () => {
  const posted = sessionReducer(
    sessionReducer(running(), {
      type: "outbound_post",
      payload: { type: "outbound_post", toolUseId: "t1", to: "Orchestrator", text: "DONE" },
    }).state,
    { type: "result" },
  ).state;
  assert.equal(posted.activity, "awaiting_peer");
  assert.equal(posted.postedThisTurn, false, "the flag is already cleared by `result`");
  assert.equal(parkNoticeFor(posted), null);
  assert.equal(findEff(sessionReducer(posted, { type: "idle_timeout" }).effects, "notice"), undefined);
});

test("a turn that posted NOTHING parks WITH a report naming the cause", () => {
  const quiet = sessionReducer(running(), { type: "result" }).state;
  assert.equal(quiet.activity, "idle");
  const n = parkNoticeFor(quiet);
  assert.equal(n.code, DROP_PARKED_SILENT);
  assert.equal(n.reason, "paused without reporting");
  const eff = findEff(sessionReducer(quiet, { type: "idle_timeout" }).effects, "notice");
  assert.equal(eff.code, DROP_PARKED_SILENT);
});

// A stand-by agent (`idle: !goal` on the directive lane) is parked having been asked nothing.
test("a session that never took a turn is NOT a drop", () => {
  const fresh = running();
  assert.equal(fresh.turns, 0);
  assert.equal(parkNoticeFor(fresh), null);
  assert.equal(findEff(sessionReducer(fresh, { type: "idle_timeout" }).effects, "notice"), undefined);
});

test("an auth hold parks with NO report — its own sentence already says a person is needed", () => {
  const quiet = sessionReducer(running(), { type: "result" }).state;
  const r = sessionReducer(quiet, { type: "auth_hold" });
  assert.equal(findEff(r.effects, "notice"), undefined);
  assert.equal(findEff(r.effects, "lifecycle").body.includes("sign-in"), true);
});

test("a second park reports nothing: already parked is a no-op", () => {
  const parked = sessionReducer(sessionReducer(running(), { type: "result" }).state,
    { type: "idle_timeout" }).state;
  assert.deepEqual(sessionReducer(parked, { type: "idle_timeout" }).effects, []);
});

// ── the reducer half: which ends report ──────────────────────────────────────────

test("the 12h reap reports AND keeps the peer's calm marker — beside it, never instead", () => {
  const parked = sessionReducer(sessionReducer(running(), { type: "result" }).state,
    { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "abandon_timeout" });
  assert.equal(findEff(r.effects, "lifecycle").body, INACTIVE_NOTE, "the counterparty note stays");
  assert.equal(findEff(r.effects, "notice").code, DROP_ENDED);
  assert.equal(findEff(r.effects, "notice").reason, "left parked");
  // The cause reaches the frozen history, which was NULL on every reaped record on this machine.
  assert.equal(findEff(r.effects, "settle").endCode, "abandoned");
});

test("the operator's own End reports nothing: they did it, and they know", () => {
  const r = sessionReducer(running(), { type: "end" });
  assert.equal(findEff(r.effects, "notice"), undefined);
  assert.equal(findEff(r.effects, "settle").endCode, "operator");
});

test("endNoticeFor answers only for the ends nobody chose", () => {
  assert.equal(endNoticeFor("abandoned").reason, "left parked");
  assert.equal(endNoticeFor("inactive").reason, "went inactive");
  assert.equal(endNoticeFor("operator"), null);
  assert.equal(endNoticeFor("claimed"), null, "a person joining is already visible to the room");
});

// ── the executor half: the pure helpers ─────────────────────────────────────────

// ⚠ READING THE RING TAIL BLINDLY REPORTS THE SYMPTOM AS THE CAUSE: the last entry at park time is
// the park's own "Paused — idle".
test("lastActivityOf skips status lines and prefers the tool name", () => {
  assert.equal(notice.lastActivityOf([
    { kind: "tool", tool: "Bash" },
    { kind: "status", text: "Paused — idle" },
  ]), "Bash");
  assert.equal(notice.lastActivityOf([{ kind: "result", ok: true }]), "a tool result");
  assert.equal(notice.lastActivityOf([{ kind: "post", text: "x" }]), "a channel post");
  assert.equal(notice.lastActivityOf([]), "");
  assert.equal(notice.lastActivityOf(null), "");
  assert.equal(notice.lastActivityOf([{ kind: "status", text: "only a status" }]), "");
});

test("oneLine bounds arbitrary model output to a single line", () => {
  assert.equal(notice.oneLine("a\nb\tc   d"), "a b c d");
  assert.equal(notice.oneLine("x".repeat(500), 10).length, 10);
  assert.equal(notice.oneLine(null), "");
});

// Product copy rule: no em dash anywhere in what a reader sees.
test("the sentence names the agent, what happened and where it stopped — and no em dash", () => {
  const park = notice.noticeText("Row Cap Fix", "parked_silent", "paused without reporting", "Bash");
  assert.match(park, /^Row Cap Fix paused without reporting \(last: Bash\)\./);
  assert.match(park, /resumable/, "a parked agent can still be woken, and the text says so");
  const ended = notice.noticeText("Row Cap Fix", "ended", "left parked", "");
  assert.match(ended, /^Row Cap Fix ended: left parked\./);
  assert.match(ended, /relaunching/, "a reaped agent is gone, and the text says so");
  for (const t of [park, ended]) assert.equal(t.includes("—"), false);
});

test("the idempotency unit is the resume CYCLE, so park→resume→park stays two rows", () => {
  const a = notice.noticeKey({ key: "c:t:ag", sdkSessionId: "sdk-1" }, "parked_silent");
  const b = notice.noticeKey({ key: "c:t:ag", sdkSessionId: "sdk-2" }, "parked_silent");
  assert.notEqual(a, b);
  assert.equal(a, notice.noticeKey({ key: "c:t:ag", sdkSessionId: "sdk-1" }, "parked_silent"));
  assert.notEqual(a, notice.noticeKey({ key: "c:t:ag", sdkSessionId: "sdk-1" }, "ended"));
});

// ── the executor half: the one policy call the reducer cannot make ──────────────

test("a WINDOWED session is never reported: the operator is looking at it", () => {
  assert.equal(notice.report({ channelId: "c", windowless: false, key: "k" },
    { code: "parked_silent" }), false);
  assert.equal(notice.report({ channelId: "c", key: "k" }, { code: "parked_silent" }), false);
});

test("report never throws on junk, because it runs inside a teardown", () => {
  assert.equal(notice.report(null, null), false);
  assert.equal(notice.report({ windowless: true }, { code: "ended" }), false, "no channel, no post");
});

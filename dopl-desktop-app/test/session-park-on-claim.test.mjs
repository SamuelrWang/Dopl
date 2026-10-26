// RULING 5 (Samuel, 2026-08-26) — a container that gains a PEER stops its live sessions and
// tells the operator. The CONSEQUENCE of the carryover invariant (plan §4.5, INVARIANTS §11):
// THE CEILING BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW.
//
// ⚠ WHAT THIS IS NOT. It is not a fence, and a green run here proves nothing about containment —
// the session already holds what it holds, and no code can un-read it. What it protects is that
// a session running under the SOLO assumption does not keep running after that assumption stops
// being true, and that the operator is told rather than left to notice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const M = (f) => join(HERE, "..", "main", f);
const P = require_(M("session-park-on-claim.js"));

const solo = (id) => ({ id, kind: "link", memberCount: 1 });
const shared = (id) => ({ id, kind: "link", memberCount: 2 });
const standard = (id) => ({ id, kind: "standard", memberCount: 9 });

// ── the transition ──────────────────────────────────────────────────────────

test("a SOLO container that gains a peer is newly shared", () => {
  const first = P.newlySharedContainers([solo("c1")], null);
  assert.deepEqual(first.newly, [], "the first pass RECORDS and never fires");
  const second = P.newlySharedContainers([shared("c1")], first.shared);
  assert.deepEqual(second.newly, ["c1"]);
});

test("🔒 THE FIRST PASS NEVER FIRES — a restart is not a claim", () => {
  // Every container already shared at app launch is recorded silently. Firing here would make a
  // security notice indistinguishable from a routine boot, and there are no sessions to end yet.
  const first = P.newlySharedContainers([shared("c1"), shared("c2")], null);
  assert.deepEqual(first.newly, []);
  assert.deepEqual([...first.shared].sort(), ["c1", "c2"]);
});

test("a container that is ALREADY shared does not fire again", () => {
  const a = P.newlySharedContainers([shared("c1")], new Set(["c1"]));
  assert.deepEqual(a.newly, []);
});

test("a peer LEAVING drops it from the set, so a re-join fires again", () => {
  // §4A: departure IS removal, and a container back at one member is an ordinary state.
  const left = P.newlySharedContainers([solo("c1")], new Set(["c1"]));
  assert.deepEqual(left.newly, []);
  assert.equal(left.shared.has("c1"), false);
  const rejoined = P.newlySharedContainers([shared("c1")], left.shared);
  assert.deepEqual(rejoined.newly, ["c1"]);
});

test("standard workspaces are never containers, whatever their member count", () => {
  const a = P.newlySharedContainers([standard("w1")], new Set());
  assert.deepEqual(a.newly, []);
  assert.equal(a.shared.size, 0);
});

test("🔒 an ABSENT memberCount counts as SHARED — and the first-pass rule makes that safe", () => {
  // §8 inverted, the third place this wave applies it that way. An older server reports every
  // container as shared on pass one, records them all, and fires on none of them.
  const first = P.newlySharedContainers([{ id: "c1", kind: "link" }], null);
  assert.deepEqual(first.newly, [], "recorded, not fired");
  assert.equal(first.shared.has("c1"), true);
  // ...and a container that really does gain a peer later still fires.
  const next = P.newlySharedContainers([{ id: "c2", kind: "link" }], first.shared);
  assert.deepEqual(next.newly, ["c2"]);
});

test("garbage rows are skipped rather than thrown on", () => {
  const a = P.newlySharedContainers([null, {}, { kind: "link" }, shared("c1")], new Set());
  assert.deepEqual(a.newly, ["c1"]);
  assert.deepEqual(P.newlySharedContainers(null, new Set()).newly, []);
});

// ── selection ───────────────────────────────────────────────────────────────

test("only the newly-shared container's sessions are selected", () => {
  const live = [
    { key: "a", workspaceId: "c1", channelId: "ch1", threadId: "t1" },
    { key: "b", workspaceId: "c2", channelId: "ch2", threadId: "t2" },
    { key: "c", workspaceId: "w-standard", channelId: "ch3", threadId: "t3" },
  ];
  assert.deepEqual(P.sessionsToStop(live, ["c1"]).map((s) => s.key), ["a"]);
  assert.deepEqual(P.sessionsToStop(live, ["c1", "c2"]).map((s) => s.key).sort(), ["a", "b"]);
});

test("nothing newly shared selects nothing, and a session with no channel is skipped", () => {
  const live = [{ key: "a", workspaceId: "c1", channelId: null, threadId: "t1" }];
  assert.deepEqual(P.sessionsToStop(live, []), []);
  assert.deepEqual(P.sessionsToStop(live, ["c1"]), []);
  assert.deepEqual(P.sessionsToStop(null, ["c1"]), []);
});

// ── what the operator is told ───────────────────────────────────────────────
//
// NOTHING, as of 2026-10-09. "My sessions ended because a peer joined" is not on Samuel's
// notification list (KB dopl-development "Notification Spec Samuel 2026-10-09"), so the banner
// and its copy builder (`claimNotice`) are both gone, and the test that pinned that copy with
// them. The sessions still END — that is asserted above and below — and the Agents tab still
// shows them ended. This module no longer raises anything, which the next test pins.

test("the module raises no notification at all", () => {
  // ⚠ THIS CASE WAS FAIL-OPEN UNTIL 2026-10-11 (review item 6). It greped for `new Notification` and a
  // bare `require('electron')` — the pre-2026-10-09 way of raising a banner — and the whole point of
  // that wave was that EVERY raise site moved to `require('./notification-route').raise(...)`. So the
  // one idiom a banner would actually reappear as was the one idiom this did not look for, and the case
  // read as coverage while checking for a spelling nothing uses any more.
  // ⚠ AND IT IS OVER `codeOf`. The old `replace(/\/\/.*$/gm, "")` strips line comments only, so a block
  // comment naming any of these satisfied it; `codeOf` masks every comment form through the parser.
  const src = codeOf(readFileSync(M("session-park-on-claim.js"), "utf8"));
  assert.doesNotMatch(src, /new Notification/, "ending a session is not an alert any more");
  assert.doesNotMatch(src, /require\(['"]electron['"]\)/, "and it needs no window layer to do it");
  assert.doesNotMatch(src, /notification-route/,
    "…nor through the route, which is how every raise site in this tree is spelled since 2026-10-09");
  // Belt: the route's three doors by name, in case it is ever reached through an injected handle.
  for (const door of [/\braise\s*\(/, /raiseCoalesced\s*\(/, /raiseResumeOffer\s*\(/]) {
    assert.doesNotMatch(src, door, `a raise door (${door}) is a banner by another name`);
  }
});

// ── the wiring ──────────────────────────────────────────────────────────────

test("🔒 it ENDS through the ONE stop path, never a second teardown", () => {
  // `end` → `endEffects` → `session-teardown.js › settle`, which that file's header calls the
  // one teardown every terminal reaches. A parallel stop would be a second set of the orphaned-
  // child bugs it exists to prevent. ⚠ It also gives the container credential back, so the NEXT
  // session in that room mints a locked one.
  const src = readFileSync(M("session-park-on-claim.js"), "utf8");
  assert.match(src, /action: 'end'/, "the stop is `end`, which reaches settle");
  assert.ok(!/'interrupt'/.test(src), "interrupt is not a stop — it leaves the session live");
});

test("🔒 the reconcile pass calls it, with the list it already fetched", () => {
  // The signal is a POLL on `GET /api/workspaces`, which since 2026-08-26 carries `memberCount`.
  // Roster changes do not otherwise reach the desktop MAIN process at all.
  const listener = readFileSync(M("channel-listener.js"), "utf8");
  assert.match(listener, /parkOnClaim\.noteWorkspaces\(workspaces, diag\)/);
});

test("🔒 listLiveSessions carries workspaceId, or nothing could be selected", () => {
  const reopen = readFileSync(M("session-reopen.js"), "utf8");
  assert.match(reopen, /workspaceId: s\.workspaceId \|\| null/);
});

test("the pure block reaches no electron and no require", () => {
  const src = readFileSync(M("session-park-on-claim.js"), "utf8");
  const from = src.indexOf("// ─── BEGIN PARK-ON-CLAIM-PURE");
  const to = src.indexOf("// ─── END PARK-ON-CLAIM-PURE");
  assert.ok(from !== -1 && to > from, "sentinels missing/out of order");
  const block = src.slice(from, to);
  for (const banned of ["require(", "electron", "process."]) {
    assert.ok(!block.includes(banned), `the pure block must not reference ${banned}`);
  }
});

test("noteWorkspaces is best-effort — a broken pass never throws at the listener", () => {
  // It runs inside the reconcile that keeps every channel loop alive. A throw here would take the
  // listener down in order to end a session, which is worse than the thing it prevents.
  P.resetForTests();
  assert.doesNotThrow(() => P.noteWorkspaces(undefined, () => {}));
  assert.doesNotThrow(() => P.noteWorkspaces([{ id: "c1", kind: "link" }], () => {}));
});

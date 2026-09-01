// ONE UUID RULE, SEVERAL SPELLINGS — pinned rather than de-duplicated, and the reason matters.
//
// ⚠ WHAT WAS MEASURED (2026-08-20). The v4-shaped id regex appeared SIX times in `main/`:
// `channel-dir-ipc.js`, `ui-bridge.js`, `session-state-push.js › WIRE_UUID_RE`,
// `queued-notice.js › UUID`, `claude-resolve.js`, and inline in `targeting.js`. Six copies of
// one predicate, kept in step by nothing.
//
// TWO WERE REMOVED OUTRIGHT in the same pass: `channel-dir-ipc.js` took `isUuid` from
// `main/ipc-guards.js` (its whole pure block moved there), and `claude-resolve.js`'s went with
// the deleted `channelCwd`. THE REST CANNOT BE, and this file exists because that is a real
// constraint and not laziness — `ui-bridge.js` included, which takes the shared SENDER guard
// while keeping a UUID copy, because that one backs `isWorkspaceId` inside its own sliced block:
//
// ⚠ EACH SURVIVING COPY SITS INSIDE ITS OWN BEGIN/END "PURE BLOCK". Those blocks are sliced out
// of their modules and evaluated with `new Function` by their suites, so they may contain no
// `require` at all — that is the whole idiom this tree tests main/ with. Importing a shared
// `isUuid` into one would break its harness. The blocks are the units; a shared constant across
// them is structurally impossible unless the shared module is itself a block others slice,
// which is what `ipc-guards.js` is for the TWO cases that could take it.
//
// SO THE DRIFT IS PINNED INSTEAD OF THE COPIES REMOVED. That converts "N copies that can
// silently disagree" into "N copies that cannot", which is the property that actually matters
// — a UUID gate is an ANTI-PROBE guard, and one spelling admitting what another refuses is how
// an id reaches a store key or a router path it should not.
//
// ⚠ THIS IS A CENSUS AS WELL AS A COMPARISON. A NEW copy added anywhere in `main/` fails here
// until it is listed, so the count cannot grow unnoticed — which is how it got to six.
//
// Run: `node --test dopl-desktop-app/test/uuid-rule-parity.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

// The canonical spelling, from the one module that exists to hold it.
const CANON = String.raw`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`;

// Every file that legitimately carries a copy, and WHY it cannot take the shared one.
const EXPECTED = {
  "ipc-guards.js": "the shared source itself — sliced by two IPC suites",
  // ⚠ MOVED 2026-08-31, NOT ADDED. The copy used to sit in `session-state-push.js`; the three
  // wire refusals it backs (the ad-hoc key, the nameless row, the ended row) split into their own
  // module at the §1 cap, and the constraint travelled with them UNCHANGED — the push module's
  // SESSION-STATE-PUSH block may hold no require, so it takes the filter as an INJECTED free var
  // and the filter is a plain module the harness passes in. `ipc-guards.js › isUuid` is still
  // unreachable from the block that consumes this rule, which is why the copy survives the move.
  "session-state-push-wire.js": "backs the wire refusals, injected INTO the push module's sliced block",
  "queued-notice.js": "inside the queued-notice pure block, sliced by queued-notice.test",
  "targeting.js": "inline in the classify block, sliced by _classify-harness and by live/desktop.js",
  // ⚠ MEASURED, NOT ASSUMED. ui-bridge.js takes the shared `isAppWindowSender` from
  // ipc-guards.js — but its UUID copy backs `isWorkspaceId`, which lives INSIDE
  // UI-BRIDGE-PURE and is sliced by `ui-bridge-guards.test.mjs`. Same constraint as the other
  // three: the block may hold no require. Only `channel-dir-ipc.js` could give its copy up,
  // because its whole pure block moved into ipc-guards.js.
  "ui-bridge.js": "inside UI-BRIDGE-PURE (isWorkspaceId), sliced by ui-bridge-guards.test",
  // ⚠ JOINED 2026-08-22 (the orchestrator launch lane), and it is a REVIEW rather than a rename:
  // `launch-directive-wire.js` states the desktop's half of the `channel_launch_directives`
  // contract, and its whole body sits inside LAUNCH-DIRECTIVE-WIRE — a pure block that
  // `launch-directives.test.mjs` evaluates and that, like every other entry here, MAY HOLD NO
  // REQUIRE. `ipc-guards.js › isUuid` is therefore unreachable from it.
  // ⚠ AND THE COPY IS LOAD-BEARING, not incidental: it is what refuses a directive whose `id` or
  // `channel_id` is not a UUID. Those two strings are about to be POSTed and handed to a spawn,
  // and the row arrives over a realtime frame this module deliberately does not trust.
  "launch-directive-wire.js": "inside LAUNCH-DIRECTIVE-WIRE, sliced by launch-directives.test",
  // ⚠ JOINED 2026-08-31 (the PRIVATE DIRECT LANE), on `launch-directive-wire.js`'s terms exactly:
  // `agent-direction-wire.js` states the desktop's half of the `channel_agent_directions`
  // contract, its whole body sits inside AGENT-DIRECTION-WIRE — a pure block its suite
  // evaluates and that, like every other entry here, MAY HOLD NO REQUIRE — so
  // `ipc-guards.js › isUuid` is unreachable from it.
  // ⚠ AND THE COPY IS LOAD-BEARING, not incidental: it is what refuses a direction whose `id` or
  // `channel_id` is not a UUID, on a row that arrives over a realtime frame this module
  // deliberately does not trust. Its SIBLING copy of the agent-id grammar is load-bearing for
  // the same reason and is sharper — a direction with no valid agent id has nowhere to go, and
  // guessing is the one thing this lane refuses to do.
  "agent-direction-wire.js": "inside AGENT-DIRECTION-WIRE, sliced by agent-directions.test",
};

/** Every occurrence of the rule in main/, by file. */
function census() {
  const found = {};
  for (const f of readdirSync(MAIN).filter((n) => n.endsWith(".js"))) {
    const src = read(f);
    const hits = src.match(/\/\^\[0-9a-f\]\{8\}[^\n]*?\/i/g) || [];
    if (hits.length) found[f] = hits;
  }
  return found;
}

test("every spelling of the UUID rule in main/ is byte-identical", () => {
  const found = census();
  for (const [file, hits] of Object.entries(found)) {
    for (const hit of hits) {
      assert.equal(hit, CANON, `${file} spells the UUID rule differently`);
    }
  }
});

test("the census is exactly the files that CANNOT take the shared isUuid", () => {
  // ⚠ A NEW ENTRY HERE IS A REVIEW, NOT A RENAME. Before adding one, check whether the file
  // really needs its own copy: `main/ipc-guards.js › isUuid` is importable by anything that is
  // not inside a sliced pure block, and two files gave theirs up that way on 2026-08-20.
  assert.deepEqual(Object.keys(census()).sort(), Object.keys(EXPECTED).sort());
});

test("the IPC OPS surfaces take the shared rule, and declare none of their own", () => {
  // The regression this closes: `channel-dir-ipc.js` declared the rule beside its own copy of
  // the sender guard — the predicate that had already drifted (F-221) — and the ops half split
  // out of it. Both import; neither may grow a local copy, because neither is sliced any more.
  for (const f of ["channel-dir-ipc.js", "session-ipc-ops.js"]) {
    const src = read(f);
    assert.match(src, /require\('\.\/ipc-guards'\)/, `${f} takes the shared guards`);
    assert.equal(/\[0-9a-f\]\{8\}/.test(src), false, `${f} must not re-declare the rule`);
  }
});

test("every copy accepts and refuses the same ids", () => {
  // ⚠ BEHAVIOUR, NOT JUST BYTES. Identical source is the strong check; this is the one that
  // survives a reformat, and it is what the copies are actually FOR.
  const good = [
    "44444444-4444-4444-8444-444444444444",
    "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", // case-insensitive by the /i flag
  ];
  const bad = [
    "", " ", "not-a-uuid",
    "44444444-4444-4444-8444-44444444444", // one short
    "44444444-4444-4444-8444-4444444444444", // one long
    "44444444444444448444444444444444", // no dashes
    " 44444444-4444-4444-8444-444444444444", // leading space (the ^ anchor)
    "44444444-4444-4444-8444-444444444444 ", // trailing space (the $ anchor)
    "44444444-4444-4444-8444-444444444444\nx", // ⚠ the anchors must not be multiline
    "g4444444-4444-4444-8444-444444444444", // non-hex
  ];
  for (const [file, hits] of Object.entries(census())) {
    for (const hit of hits) {
      // Evaluating the SHIPPED literal, deliberately — a hand-rewritten copy here would
      // test this file's idea of the rule rather than main/'s.
      const re = new Function(`return ${hit};`)();
      for (const id of good) assert.equal(re.test(id), true, `${file} refuses a valid id: ${id}`);
      for (const id of bad) assert.equal(re.test(id), false, `${file} admits an invalid id: ${JSON.stringify(id)}`);
    }
  }
});

// ── The same shape, for the ONE other bound written twice ────────────────────────────

test("the 1:1 composer's cap is the same number in the preload and at the boundary", () => {
  // ⚠ TWO BOUNDS ON ONE SENTENCE, DELIBERATELY: the preload caps as a convenience and
  // `session-ipc-ops.js` caps as the FENCE. They are allowed to be two writes; they are not
  // allowed to be two NUMBERS, because the visible difference would be a composer that lets
  // the operator type past what main will accept and silently truncates.
  const ops = read("session-ipc-ops.js");
  const preload = readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8");
  const cap = ops.match(/const MESSAGE_CAP = (\d+);/);
  assert.ok(cap, "session-ipc-ops.js names the cap");
  const preloadCap = preload.match(/\.slice\(0, (\d+)\)/);
  assert.ok(preloadCap, "the preload caps the body");
  assert.equal(preloadCap[1], cap[1], "the preload and the boundary must agree on the number");
});

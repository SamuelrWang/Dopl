// P4-14 — ONE TEARDOWN, AND IT ALWAYS CLOSES THE RUNTIME'S HANDLE.
//
// Five sites tore a query down with their own copy of "abort, close the iterator, close the
// handle", and three of them skipped the handle close — the only thing that ends a Codex child.
// `session-handles.js › teardownHandles` is the one copy; this drives it and the auth hold's
// converge case (no reducer abort runs there), and pins that every site goes through it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { harness, session } from "./_auth-hold-harness.mjs";
import { between, fnOf } from "./helpers/source-probe.mjs";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const { teardownHandles } = require_(join(MAIN, "session-handles.js"));

/** A session holding a Codex-shaped handle: `close()` is what ends its child. */
function live(over = {}) {
  const calls = [];
  const handle = { close: () => calls.push("handle.close") };
  const s = {
    abortController: { abort: () => calls.push("abort") },
    pushIterator: { close: () => calls.push("iterator.close") },
    query: handle,
    ...over,
  };
  return { s, calls, handle };
}

test("teardown aborts, closes the stream and closes the runtime's handle", () => {
  const { s, calls, handle } = live();
  teardownHandles(s);
  assert.deepEqual(calls, ["abort", "iterator.close", "handle.close"]);
  assert.equal(s.query, handle, "without `supersede` the handle stays on the session");
});

test("supersede closes the handle BEFORE it is nulled, so the relaunch cannot leak the child", () => {
  const { s, calls } = live();
  teardownHandles(s, { supersede: true });
  assert.deepEqual(calls, ["abort", "iterator.close", "handle.close"]);
  assert.equal(s.query, null, "the old consume loop is now inert (`s.query !== q`)");
});

test("a Claude query (no `close`), a cold session and a throwing step are all safe", () => {
  const claude = live({ query: { interrupt() {} } });
  assert.doesNotThrow(() => teardownHandles(claude.s));
  assert.deepEqual(claude.calls, ["abort", "iterator.close"]);
  assert.doesNotThrow(() => teardownHandles({ abortController: null, pushIterator: null, query: null }, { supersede: true }));
  assert.doesNotThrow(() => teardownHandles(null));
  const calls = [];
  const s = {
    abortController: { abort: () => { throw new Error("already aborted"); } },
    pushIterator: { close: () => { throw new Error("closed"); } },
    query: { close: () => calls.push("handle.close") },
  };
  teardownHandles(s);
  assert.deepEqual(calls, ["handle.close"], "an earlier step throwing never skips the handle close");
});

test("the auth hold's CONVERGE case closes the handle — the reducer runs no abort there", () => {
  const h = harness();
  const { s, calls } = live();
  const held = session({ ...s, authHold: { kind: "error" } });
  held.state = { ...held.state, authHeld: true };
  assert.equal(h.holdIfAuthFailure(held, "OAuth token has expired"), true);
  assert.deepEqual(h.calls.effects, [], "already held: the reducer's auth_hold is a no-op");
  assert.ok(calls.includes("handle.close"), "so the hold itself must close the runtime's handle");
});

test("every teardown site goes through the helper", () => {
  const read = (f) => readFileSync(join(MAIN, f), "utf8");
  const engine = read("session-engine.js");
  assert.match(between(engine, "case 'abortQuery':", "case 'denyPending':"), /teardownHandles\(s\);/);
  assert.match(engine, /teardown: teardownHandles \}\);/, "the auth hold is handed the same helper");
  assert.match(fnOf(read("session-teardown.js"), "settle"), /teardownHandles\(s\);/);
  assert.match(fnOf(read("session-query.js"), "abortInFlight"), /teardownHandles\(s, \{ supersede: true \}\);/);
  assert.match(fnOf(read("session-auth.js"), "holdIfAuthFailure"), /deps\.teardown\(s\);/);
  // The resume door's reap is in a pure block that may not require, so it repeats the steps inline.
  assert.match(fnOf(read("session-park.js"), "reapPriorChild"), /typeof prior\.close === 'function'\) prior\.close\(\)/);
});

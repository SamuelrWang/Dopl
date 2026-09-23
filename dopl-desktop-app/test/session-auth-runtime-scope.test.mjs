// P4-15 — THE POST-SIGN-IN RELAUNCH ACQUIRES THE SESSION'S OWN RUNTIME.
//
// A preflight hold's release re-runs the launch through `deps.acquireRuntime()` with no id, which
// answers the registry DEFAULT — a Codex session's spec would have started on the Claude adapter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, session } from "./_auth-hold-harness.mjs";

test("a held session relaunches on the runtime it was stamped with", async () => {
  const h = harness({ usable: false });
  const s = session({ runtimeId: "codex", windowless: false });
  assert.equal(h.holdIfNoCredential(s), true);
  h.state.usable = true;
  await h.resumeAfterSignIn(s);
  assert.deepEqual(h.calls.acquired, ["codex"]);
  assert.equal(h.calls.startQuery.length, 1);
});

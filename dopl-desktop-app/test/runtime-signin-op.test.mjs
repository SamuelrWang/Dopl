// `runtime:signIn` (2026-09-23) — the one in-app sign-in op, routed through the registry. Replaces the
// Claude-only `claude:signIn`; Claude's own flow is pinned in `claude-signin-recovery.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";
import { bootIpc } from "./_ipc-harness.mjs";

const copy = real("./runtime/runtime-copy");
const registry = real("./runtime");

function opWith(signIns) {
  const calls = [];
  const fake = {
    DEFAULT_ID: "claude",
    ids: () => ["claude", "codex", "cursor"],
    descriptorFor: (id) => registry.descriptorFor(id),
    runtimeFor: (id) => ({
      signIn: async () => {
        calls.push(id);
        const answer = signIns[id];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    }),
    copy,
  };
  const op = loadWithStubs("runtime-signin-op.js", { "./runtime": fake, "./diag": { diag: () => {} } });
  return { op, calls };
}

test("it runs the NAMED runtime's own sign-in and passes its answer through", async () => {
  const { op, calls } = opWith({ codex: { ok: true, resumed: 3 }, claude: { ok: true, resumed: 1 } });
  assert.deepEqual(await op.signIn("codex"), { ok: true, resumed: 3 });
  assert.deepEqual(await op.signIn("claude"), { ok: true, resumed: 1 });
  assert.deepEqual(calls, ["codex", "claude"]);
});

test("'' is the default runtime — an un-stamped agent is the default's, exactly as before", async () => {
  const { op, calls } = opWith({ claude: { ok: true, resumed: 0 } });
  assert.deepEqual(await op.signIn(""), { ok: true, resumed: 0 });
  assert.deepEqual(calls, ["claude"]);
});

test("an unregistered runtime or one with no in-app flow refuses without running anything", async () => {
  const { op, calls } = opWith({});
  assert.deepEqual(await op.signIn("nope"), { ok: false });
  assert.deepEqual(await op.signIn("cursor"), { ok: false }, "Cursor declares interactiveSignIn: null");
  assert.deepEqual(calls, []);
});

test("a failed or throwing sign-in is the bare refusal", async () => {
  const { op } = opWith({ codex: { ok: false, reason: "cancelled" }, claude: new Error("boom") });
  assert.deepEqual(await op.signIn("codex"), { ok: false }, "no reason crosses");
  assert.deepEqual(await op.signIn("claude"), { ok: false });
});

test("the boundary refuses a malformed id before any flow module loads", async () => {
  const ipc = bootIpc();
  for (const runtimeId of ["../codex", "Codex", 42, { id: "codex" }, "x".repeat(40)]) {
    assert.deepEqual(await ipc.handlers["runtime:signIn"](ipc.shell, { runtimeId }), { ok: false }, String(runtimeId));
  }
  assert.deepEqual(ipc.dialogs, []);
});

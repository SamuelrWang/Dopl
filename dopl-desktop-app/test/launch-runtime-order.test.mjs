// THE LAUNCH RUNTIME ORDER (C3, Samuel's ruling 5): the launcher's pick -> the identity's runtime
// -> the channel's runtime -> the registry default. The two ASKS refuse (`no-sdk`) rather than
// swap vendors; the two inherited defaults fail open. Driven over a fake registry.
//
// Run: `node --test dopl-desktop-app/test/launch-runtime-order.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fakeRegistry } from "./_launch-runtime-stub.mjs";

const require = createRequire(import.meta.url);
const LD = require(join(dirname(fileURLToPath(import.meta.url)), "..", "main", "runtime", "launch-default.js"));

const resolveWith = (args, { usable, channel = "" } = {}) =>
  LD.resolveLaunchRuntime(args, { registry: fakeRegistry(usable), channelRuntime: { getChannelRuntime: () => channel } });

test("C3: pick -> identity.runtime -> channel -> default", async () => {
  assert.deepEqual(await resolveWith({ pick: "cursor", identity: { runtime: "codex" } }, { channel: "claude" }),
    { ok: true, runtimeId: "cursor", source: "pick" });
  assert.deepEqual(await resolveWith({ identity: { runtime: "codex" } }, { channel: "cursor" }),
    { ok: true, runtimeId: "codex", source: "identity" });
  assert.deepEqual(await resolveWith({ identity: { runtime: "" } }, { channel: "cursor" }),
    { ok: true, runtimeId: "cursor", source: "channel" });
  assert.deepEqual(await resolveWith({ identity: null }), { ok: true, runtimeId: "claude", source: "default" });
});

test("C3: an unregistered or unusable PICK or IDENTITY runtime is refused, never swapped", async () => {
  assert.deepEqual(await resolveWith({ pick: "borg" }), { ok: false, reason: "no-sdk", runtimeId: "borg" });
  assert.deepEqual(await resolveWith({ pick: "codex" }, { usable: ["claude"] }), { ok: false, reason: "no-sdk", runtimeId: "codex" });
  assert.deepEqual(await resolveWith({ identity: { runtime: "cursor" } }, { usable: ["claude"] }),
    { ok: false, reason: "no-sdk", runtimeId: "cursor" });
});

test("C3: the channel and the default FAIL OPEN, as they always did", async () => {
  assert.deepEqual(await resolveWith({}, { channel: "codex", usable: [] }), { ok: true, runtimeId: "codex", source: "channel" });
  assert.deepEqual(await resolveWith({}, { channel: "borg" }), { ok: true, runtimeId: "claude", source: "default" });
  const throwing = { getChannelRuntime: () => { throw new Error("store"); } };
  assert.deepEqual(await LD.resolveLaunchRuntime({}, { registry: fakeRegistry(), channelRuntime: throwing }),
    { ok: true, runtimeId: "claude", source: "default" });
});

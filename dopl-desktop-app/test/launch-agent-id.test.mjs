// THE PRE-ASSIGNED INSTANCE ID — `sessions:mintAgentId` + the forward through
// `main/session-launch-op.js › launchFromButton` (2026-08-27, Samuel's launch-panel ruling).
//
// WHY THIS FILE EXISTS. The composer's launch panel shows the operator the agent's ID while
// they are still filling the form, so the id must be minted BEFORE the spawn and must be the
// id the agent really gets. Three files have to agree for that to be true:
//
//   • `main/agent-id.js › newAgentId`  mints it            (already existed)
//   • `main/session-launch-op.js`      FORWARDS it         ← this was the gap
//   • `main/session-launch.js › launch` HONOURS it         (already existed, for resumes)
//
// ⚠ THE MIDDLE LINK IS THE ONE THAT CAN ROT SILENTLY, AND THAT IS THE POINT OF THIS FILE.
// `launchFromButton` rebuilds the engine args field by field, so the id is forwarded by ONE
// line in a ~40-field object literal. Delete that line and everything still works: the launch
// succeeds, an agent starts, `{ ok: true, agentId }` comes back — main has simply minted a
// DIFFERENT id, and the panel has already shown the operator one the agent does not have. No
// error, no failing test anywhere else in either tree. An operator who then `@`-mentions the
// id they read addresses nobody.
//
// ⚠ SO THE PIN IS ON THE VALUE, NOT ON THE CALL. `assert.equal(spec.agentId, MINE)` fails the
// moment the forward is dropped, because the field goes `undefined`. A test that only checked
// "launch was called" would stay green through exactly the regression this guards.
//
// METHOD: the SHIPPED launch body, evaluated against a stub `require` and driven for real —
// the same bargain `session-launch-template.test.mjs` makes, and the engine is faked at the one
// seam that would otherwise start a process.
//
// Run: `node --test dopl-desktop-app/test/launch-agent-id.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const CH = "11111111-1111-4111-8111-111111111111";
const THREAD = "22222222-2222-4222-8222-222222222222";

/** A real id by `agent-id.js`'s own charset: a letter, then seven of [a-z0-9]. */
const MINE = "k3v7d2mq";

function boot() {
  const launches = [];
  const stub = (id) => {
    if (id === "./ipc-guards") return require(join(MAIN, "ipc-guards.js"));
    // ⚠ THE REAL PREDICATE, never a permissive fake: this file's whole subject is which ids
    // are accepted, and a fake that said yes to everything would assert nothing.
    if (id === "./agent-id") return require(join(MAIN, "agent-id.js"));
    if (id === "./diag") return { diag: () => {} };
    if (id === "./session-model") return require(join(MAIN, "session-model.js"));
    if (id === "./channel-listener") {
      return { watchedChannel: () => ({ channel: { myAgentToolProfile: "full" } }) };
    }
    if (id === "./targeting") return { resolveToolProfile: () => "full" };
    // Real: a blank launch calls `narrowOverrides` and nothing else in it.
    if (id === "./template-resolve") return require(join(MAIN, "template-resolve.js"));
    if (id === "./channel-prefs") {
      return {
        launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
        getLaunchModel: () => null,
        isTemplateApproved: () => true,
      };
    }
    if (id === "./session-engine") {
      return {
        launchRequesterSession: async (spec) => {
          launches.push(spec);
          // ⚠ MAIN'S OWN ANSWER, and deliberately NOT the id it was handed. The real engine
          // echoes back whatever `launch` settled on; answering something else here is what
          // keeps the assertions below about the FORWARD rather than about this stub.
          return { agentId: "zzzzzzzz", sessionId: "s-1" };
        },
      };
    }
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", read("session-launch-op.js"))(stub, mod, mod.exports);
  return { ...mod.exports, launches };
}

const payload = (over = {}) => ({ channelId: CH, taskId: THREAD, workspaceId: "ws-1", ...over });

// ── 1. THE FORWARD ───────────────────────────────────────────────────────────

test("a caller-supplied agentId REACHES the engine — the panel's id is the agent's id", async () => {
  const m = boot();
  await m.launchFromButton(payload({ agentId: MINE }));
  assert.equal(m.launches.length, 1);
  // ⚠ THE ASSERTION THIS FILE EXISTS FOR. Drop the `agentId:` line in `launchFromButton` and
  // this reads `undefined` while every other case in the tree stays green.
  assert.equal(m.launches[0].agentId, MINE, "the pre-assigned id was dropped on the way to the engine");
});

test("no agentId ⇒ the field is absent and main mints its own — the old lane is untouched", async () => {
  const m = boot();
  await m.launchFromButton(payload());
  // ⚠ `undefined`, NOT `null` OR `''`. `session-launch.js › launch` reads `isAgentId(a.agentId)`
  // and mints when it fails, so any of the three would work — but `undefined` is the spelling
  // that means "this caller said nothing", and a launch with no panel behind it says nothing.
  assert.equal(m.launches[0].agentId, undefined);
});

test("a MALFORMED id is ignored, never refused — the launch still happens", async () => {
  // ⚠ FAIL TOWARD WORKING, which is `launch`'s own direction: a renderer cannot invent a SHAPE,
  // and an id addresses rather than grants, so the honest answer to a bad one is a fresh mint
  // rather than a dead button. The panel then falls back to showing main's answer.
  for (const bad of [
    "9abcdefg",      // ⚠ leads with a digit — the charset demands a letter
    "k3v7d2m",       // seven characters
    "k3v7d2mq1",     // nine
    "k3v7-2mq",      // a `-`, which would break the `<channel>:<thread>:<agent>` slot key
    "K3V7D2MQ",      // upper case
    "",
    null,
    42,
    { toString: () => MINE }, // ⚠ COERCES NOTHING: a non-string is not an id
  ]) {
    const m = boot();
    const res = await m.launchFromButton(payload({ agentId: bad }));
    assert.equal(res.ok, true, `${JSON.stringify(bad)} must not refuse the launch`);
    assert.equal(m.launches[0].agentId, undefined, `${JSON.stringify(bad)} reached the engine`);
  }
});

// ── 2. WHAT THE FORWARD MUST NOT HAVE CHANGED ────────────────────────────────

test("SPAWN IDLE survives the id (ruling 3): register, prepare context, send NO first turn", async () => {
  // ⚠ PINNED HERE BECAUSE THIS WAVE TOUCHED THE ARG OBJECT. The panel grew a Description field
  // in the same change, and the obvious wrong wiring for it is a first message — which would
  // turn every launch into a woken agent and quietly retire ruling 3. The description is stored
  // as agent METADATA (`main/agent-names.js`); nothing on this lane sends a turn.
  const m = boot();
  await m.launchFromButton(payload({ agentId: MINE }));
  const spec = m.launches[0];
  assert.equal(spec.idle, true, "a launch must still register an IDLE agent");
  assert.equal(spec.launchDepth, 0, "a human at the keyboard is still depth 0");
  assert.equal(spec.operatorArmed, true);
  // ⚠ THE GOAL IS MAIN'S OWN SEED TEXT AND STILL CARRIES NOTHING THE PANEL TYPED. It is
  // composed here from the thread title alone, exactly as it was before this wave; a
  // description leaking into it would be the renderer writing prompt text.
  assert.equal(
    spec.goal,
    "Join this thread as my agent: read it with dopl_channel (op \"get_thread\") and carry the work forward."
  );
  assert.equal(spec.firstMessage, undefined, "the ENGINE arg — a turn is not sent from here");
});

test("the answer is still MAIN'S OWN id, never an echo of the ask", async () => {
  // ⚠ THE RENDERER MUST RECONCILE. The engine is the authority on what id the agent got, so a
  // panel that pre-assigned one still paints what comes back — the same never-echo rule
  // `rename` / `setMode` / `setModel` follow. Here the stub answers a different id on purpose.
  const m = boot();
  const res = await m.launchFromButton(payload({ agentId: MINE }));
  assert.deepEqual(res, { ok: true, agentId: "zzzzzzzz", sessionId: "s-1" });
});

// ── 3. THE MINT ITSELF ───────────────────────────────────────────────────────

test("newAgentId answers this charset, every time", () => {
  // ⚠ THE PANEL SHOWS THIS STRING AND `launch` RE-CHECKS IT, so a mint outside the charset
  // would be silently replaced at spawn — the exact lie this wave exists to remove.
  const { newAgentId, isAgentId, AGENT_ID_RE } = require(join(MAIN, "agent-id.js"));
  for (let i = 0; i < 500; i += 1) {
    const id = newAgentId();
    assert.match(id, AGENT_ID_RE);
    assert.equal(isAgentId(id), true);
  }
});

test("the mint RESERVES nothing — it is a draw, not an allocation", () => {
  // ⚠ THIS IS WHY THE PANEL MAY MINT AND THEN BE CLOSED. `newAgentId` touches no registry and
  // no store, so an id the operator never launches simply evaporates; there is nothing to
  // release and nothing to leak. A reservation scheme would need a matching free() on every
  // path out of the panel, including a crash.
  // ⚠ READS THE CODE, NOT THE PROSE. This file's docblock discusses `session-store.js` and the
  // session registry at length, so a whole-source substring check answers on the comments.
  const code = read("agent-id.js")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  for (const banned of ["store", "Store", "sessions", "registry"]) {
    assert.ok(!code.includes(banned), `agent-id.js must not reference ${banned}`);
  }
  // The ONE dependency it is allowed: the CSPRNG.
  assert.deepEqual(code.match(/require\('[^']+'\)/g), ["require('crypto')"]);
});

test("distinct draws — two panels open at once do not collide in practice", () => {
  // ⚠ NOT A PROOF AND NOT TREATED AS ONE. The real guarantee is the space (26 * 36^7 ≈ 2.0e12)
  // against at most MAX_CONCURRENT_SESSIONS live slots, and the BACKSTOP is
  // `session-launch.js`'s post-await `hasLiveSession(slot)` → `skipped: 'busy'` — the same
  // refusal the SPA already renders. This case only pins that the draw is not a constant, which
  // is the failure a broken CSPRNG would actually produce.
  const { newAgentId } = require(join(MAIN, "agent-id.js"));
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(newAgentId());
  assert.equal(seen.size, 2000, "ids repeated inside one run — the draw is not random");
});

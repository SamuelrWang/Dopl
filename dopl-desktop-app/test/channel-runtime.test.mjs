// WHICH AGENT RUNTIME A CHANNEL'S AGENTS LAUNCH ON — `main/channel-runtime.js`, and the two
// places core refuses rather than hides.
//
// ⚠ THE PROPERTY THIS FILE EXISTS FOR IS NOT "the pick round-trips". It is that a pick can only
// ever select an adapter THIS BUILD REGISTERED — and that a build which does not know a stored id
// lands on the DEFAULT rather than stranding the channel. Those are opposite-looking rules and
// they are the same rule: `main/runtime/contract.js › sealAdapter` refuses to register an adapter
// that cannot enforce every Dopl profile it declares, so "registered" is the safety property, and
// anything outside that set has to collapse onto something that is.
//
// ⚠ AND ONE ASYMMETRY WORTH STATING, because it is the first question a reader asks. The durable
// PERMISSION pair (`channel-prefs.js › getLaunchPosture`) has exactly ONE consumer and that COUNT
// is what keeps H2 closed. This record has THREE — the operator's button, the peer-triggered
// responder and the orchestrator directive — deliberately, because picking a runtime WIDENS
// NOTHING: every adapter re-derives its own deny lists and Axis-A vocabulary, and the four gate
// steps before Axis A are core's on all of them. `main/channel-runtime.js`'s header is the one
// spelling of that argument; this file drives it.
//
// ⚠ NO ELECTRON. The module opens an electron-store, so its three functions are sliced and driven
// against a fake store and a fake registry — the same idiom `channel-prefs.test.mjs` uses.
//
// Run: `node --test dopl-desktop-app/test/channel-runtime.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "channel-runtime.js"), "utf8");

// ⚠ THE REAL REGISTRY, NOT A LIST OF IDS. What "registered" means is `sealAdapter`'s answer, and
// a hand-written `['claude','codex','cursor']` here would be a second authority on it — which is
// exactly the drift `main/runtime/index.js`'s header calls the point of having a registry.
const RUNTIME = createRequire(import.meta.url)(join(MAIN, "runtime", "index.js"));

const CH_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CH_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** The module, with a fake electron-store and a real registry. */
function load(opts = {}) {
  const disk = { ...(opts.disk || {}) };
  const logged = [];
  const store = {
    get: (key) => {
      if (opts.readThrows) throw new Error("unreadable store");
      return disk[key];
    },
    set: (key, value) => {
      if (opts.writeThrows) throw new Error("read-only disk");
      disk[key] = value;
    },
  };
  const stub = (id) => {
    if (id === "electron-store") return function Store() { return store; };
    if (id === "./diag") return { diag: (...p) => logged.push(p.join(" ")) };
    if (id === "./runtime") return RUNTIME;
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  return { ...mod.exports, disk, logged };
}

// ── 1. WHAT MAY BE STORED ────────────────────────────────────────────────────────────────────

test("only a REGISTERED id normalizes to itself; everything else is the default", () => {
  const m = load();
  for (const id of RUNTIME.ids()) {
    assert.equal(m.normalizeRuntimeId(id), id, `${id} is registered and must survive`);
  }
  // ⚠ `''` IS THE ONLY SPELLING OF "NO PICK". A channel that never chose and one whose pick was
  // cleared are the same record — the rule auto-send, agent chaining and the posture's `model`
  // all follow, and it is what stops a reader growing a third state to get wrong.
  // ⚠ `"claude "` IS NOT ON THIS LIST, AND THE TRIM BELOW IS WHY. Surrounding whitespace is a
  // transport artefact, not a different id; a case-changed or path-shaped one really is.
  for (const bad of ["", " ", null, undefined, 0, false, {}, [], "CLAUDE", "gpt", "../claude"]) {
    assert.equal(m.normalizeRuntimeId(bad), "", `${JSON.stringify(bad)} must read as the default`);
  }
  assert.equal(m.normalizeRuntimeId("  codex  "), "codex", "surrounding space is trimmed, not rejected");
});

test("round trip: a pick is stored, read back, and is per channel", () => {
  const m = load();
  assert.equal(m.setChannelRuntime(CH_A, "codex"), "codex");
  assert.equal(m.getChannelRuntime(CH_A), "codex");
  assert.equal(m.getChannelRuntime(CH_B), "", "a neighbour's pick is never inherited");
});

test("clearing DELETES the key — absent and default are one record", () => {
  const m = load();
  m.setChannelRuntime(CH_A, "codex");
  assert.equal(m.setChannelRuntime(CH_A, ""), "");
  assert.deepEqual(m.disk[m.CHANNEL_RUNTIME_KEY], {}, "no tombstone, no third state");
  assert.equal(m.getChannelRuntime(CH_A), "");
});

test("an UNREGISTERED id clears rather than being parked in the store", () => {
  // The store is not a place to keep a value this build cannot resolve. The only way to reach
  // this branch is a hand-edited store or a version-skewed page, and both should land on the one
  // runtime this build is certain it ships.
  const m = load();
  m.setChannelRuntime(CH_A, "codex");
  assert.equal(m.setChannelRuntime(CH_A, "some-future-runtime"), "");
  assert.deepEqual(m.disk[m.CHANNEL_RUNTIME_KEY], {});
});

// ── 2. READING NEVER REPAIRS, AND NEVER REFUSES ──────────────────────────────────────────────

test("a stored id this build does not know reads as the default, and is NOT rewritten", () => {
  // ⚠ THE TWO HALVES ARE SEPARATE PROMISES. A DOWNGRADE must not silently throw the operator's
  // pick away — re-upgrade and it is still there — and it must not strand the channel either.
  const m = load({ disk: { channelRuntime: { [CH_A]: "some-future-runtime" } } });
  assert.equal(m.getChannelRuntime(CH_A), "", "the launch lands on the default");
  assert.deepEqual(m.disk.channelRuntime, { [CH_A]: "some-future-runtime" }, "reading wrote nothing");
});

test("a corrupt map, a missing id and an unreadable store are all the default", () => {
  assert.equal(load({ disk: { channelRuntime: ["codex"] } }).getChannelRuntime(CH_A), "");
  assert.equal(load({ disk: { channelRuntime: "codex" } }).getChannelRuntime(CH_A), "");
  assert.equal(load().getChannelRuntime(""), "");
  assert.equal(load().getChannelRuntime(null), "");
  // ⚠ AN UNREADABLE STORE IS THE DEFAULT RUNTIME, NEVER A REFUSAL — the opposite direction from
  // `orchestrator-consent.js`, whose unreadable store is "not a grant". The difference is what the
  // record MEANS: that one is a consent, this one is a choice between enforced alternatives.
  assert.equal(load({ readThrows: true }).getChannelRuntime(CH_A), "");
});

test("a failed WRITE answers the value the store actually holds", () => {
  // The SPA reverts an optimistic pick on a mismatch — `orchestrator-consent.js`'s rule, and it
  // only works if the answer is a re-read rather than an echo of the ask.
  const m = load({ disk: { channelRuntime: { [CH_A]: "codex" } }, writeThrows: true });
  assert.equal(m.setChannelRuntime(CH_A, "cursor"), "codex", "the ask is not echoed back");
  assert.ok(m.logged.some((l) => l.includes("could not persist")), "and the failure is said once");
});

test("the pick is never a SECRET: the diag carries a channel PREFIX and a public id", () => {
  const m = load();
  m.setChannelRuntime(CH_A, "codex");
  const line = m.logged.find((l) => l.includes("codex"));
  assert.ok(line, "the write is logged");
  assert.equal(line.includes(CH_A), false, "the whole channel id never reaches a support log");
  assert.ok(line.includes(CH_A.slice(0, 8)), "…the prefix does, which is what makes it useful");
});

// ── 3. THE SAFETY PROPERTY THIS RECORD LEANS ON ──────────────────────────────────────────────

test("every id this record can hold belongs to an adapter that PASSED the contract", () => {
  // ⚠ THIS IS WHY A RENDERER-SUPPLIED RUNTIME IS ACCEPTABLE WHERE A RENDERER-SUPPLIED TOOL
  // PROFILE IS NOT. Registration is not a listing: `contract.js › sealAdapter` throws unless the
  // adapter declares an Axis-B enforcement point and a real deny list for EVERY Dopl profile it
  // offers. So the worst a version-skewed page can do is select a runtime whose gate this build
  // has already proved — which widens nothing, because the four gate steps ahead of Axis A are
  // core's on every one of them.
  for (const adapter of RUNTIME.all()) {
    const d = adapter.descriptor;
    assert.ok(d.axisB.enforcementPoint, `${d.id}: a registered adapter has an Axis-B enforcement point`);
    for (const [name, p] of Object.entries(d.containment.profiles)) {
      assert.ok(Array.isArray(p.denyList), `${d.id}: profile ${name} carries a real deny list`);
    }
  }
});

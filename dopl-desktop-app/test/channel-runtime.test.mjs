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
import { evalModule } from "./helpers/module-sandbox.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "channel-runtime.js"), "utf8");

// ⚠ THE REAL REGISTRY, NOT A LIST OF IDS. What "registered" means is `sealAdapter`'s answer, and
// a hand-written `['claude','codex','cursor']` here would be a second authority on it — which is
// exactly the drift `main/runtime/index.js`'s header calls the point of having a registry.
const RUNTIME = createRequire(import.meta.url)(join(MAIN, "runtime", "index.js"));

const CH_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CH_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/**
 * The module, with a fake electron-store and a REAL registry.
 *
 * ⚠ **`./channel-prefs` IS EVALUATED FOR REAL SINCE 2026-09-21 (U5), NOT STUBBED, AND THAT IS THE
 * POINT OF THE CHANGE.** The pick used to be its own store key written by this file directly; it is
 * a FIELD of the channel's VERSIONED LAUNCH SELECTION now, beside the per-runtime model and native
 * settings it selects between. Stubbing the writer would mean these cases assert about a copy of
 * the program — and the property that matters most (switching runtime no longer destroys the other
 * runtime's remembered model) lives entirely in that writer.
 *
 * Three modules are sliced over ONE fake store document, exactly as electron-store behaves: a
 * second handle reads and writes the same JSON file.
 */
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
  const diag = { diag: (...p) => logged.push(p.join(" ")) };
  const cache = {};
  const evaluate = (file) => {
    if (!cache[file]) cache[file] = evalModule(readFileSync(join(MAIN, file), "utf8"), stub);
    return cache[file];
  };
  const stub = (id) => {
    if (id === "electron-store") return function Store() { return store; };
    if (id === "./diag") return diag;
    if (id === "./runtime") return RUNTIME;
    if (id === "./launch-selection") return evaluate("launch-selection.js");
    if (id === "./channel-prefs") return evaluate("channel-prefs.js");
    if (id === "./session-profiles") return createRequire(import.meta.url)(join(MAIN, "session-profiles.js"));
    // The three records `channel-prefs.js` re-exports and this file never touches. Stubbed rather
    // than evaluated because each opens its own store handle and none of them is under test here.
    if (id === "./channel-agent-chain") return { AGENT_CHAIN_KEY: "channelAgentChain", getAgentChain: () => false, setAgentChain: () => false };
    if (id === "./orchestrator-consent") return {};
    // The roster read behind the private-channel default (2026-09-25); `opts.solo` names solo rooms.
    if (id === "./operator-tools") return { isPrivateChannel: (c) => (opts.solo || []).includes(c) };
    if (id === "./identity-approval") return {};
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = evalModule(SRC, stub);
  const prefs = evaluate("channel-prefs.js");
  // ⚠ **THE WRITE DOOR IS `setLaunchSelection`, AND THERE IS NO `setChannelRuntime` ANY MORE
  // (2026-09-21, U5).** The pick is a FIELD of the versioned record, so it is written by that
  // record's ONE validating writer in the same write as everything it selects between — a second
  // named door issuing a second store write is exactly how a rejected posture came to half-apply a
  // runtime, and a zero-caller export would have added a name to `session-preset-start.js`'s
  // writer census that nothing calls. This local helper keeps the cases below reading as "set the
  // pick" while driving the real path the Settings tab uses.
  const setRuntime = (channelId, raw) => {
    const res = prefs.setLaunchSelection(channelId, { runtime: raw });
    return res && res.ok ? res.selection.runtime : mod.getChannelRuntime(channelId);
  };
  return { ...mod, prefs, setChannelRuntime: setRuntime, disk, logged };
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

test("an UNCONFIGURED private channel defaults to Full; shared stays Ask; a stored level always wins", () => {
  const m = load({ solo: [CH_A] });
  assert.equal(m.prefs.getLaunchSelection(CH_A).level, "full");
  assert.equal(m.prefs.getLaunchSelection(CH_B).level, "ask");
  assert.equal(m.prefs.setLaunchSelection(CH_A, { level: "auto" }).ok, true);
  assert.equal(m.prefs.getLaunchSelection(CH_A).level, "auto");
});

test("round trip: a pick is stored, read back, and is per channel", () => {
  const m = load();
  assert.equal(m.setChannelRuntime(CH_A, "codex"), "codex");
  assert.equal(m.getChannelRuntime(CH_A), "codex");
  assert.equal(m.getChannelRuntime(CH_B), "", "a neighbour's pick is never inherited");
});

test("clearing is `''` — absent and default are one record", () => {
  const m = load();
  m.setChannelRuntime(CH_A, "codex");
  assert.equal(m.setChannelRuntime(CH_A, ""), "");
  // ⚠ THE PICK IS A FIELD OF THE SELECTION SINCE U5, so "cleared" is `runtime: ''` on that record
  // rather than a deleted key in a map of its own. The RULE is unchanged and is what this case is
  // about: there is ONE spelling of "no pick", so a channel that never chose and a channel whose
  // pick was cleared read identically and no reader can grow a third state to get wrong.
  assert.equal(m.disk.channelLaunchSelection[CH_A].runtime, "", "no tombstone, no third state");
  assert.equal(m.getChannelRuntime(CH_A), "");
});

test("an UNREGISTERED id clears rather than being parked in the store", () => {
  // The store is not a place to keep a value this build cannot resolve. The only way to reach
  // this branch is a hand-edited store or a version-skewed page, and both should land on the one
  // runtime this build is certain it ships.
  const m = load();
  m.setChannelRuntime(CH_A, "codex");
  assert.equal(m.setChannelRuntime(CH_A, "some-future-runtime"), "");
  assert.equal(m.disk.channelLaunchSelection[CH_A].runtime, "");
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
  assert.deepEqual(m.disk.channelRuntime, { [CH_A]: "codex" },
    "a failed selection write leaves the downgrade mirror untouched");
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

// ── 4. THE LEVEL MODEL (2026-09-25): ONE CONTROL, EACH RUNTIME IN ITS OWN WORDS ──────────────
//
// The channel stores ONE permission level; a runtime switch changes which runtime launches, never
// the level. Each runtime applies the level in its own native settings, so Claude → Codex → Claude
// needs nothing remembered per runtime. Driven against the REAL channel-prefs over a fake store.

test("a runtime switch keeps the level; each runtime reads it in its own words", () => {
  const m = load();
  m.prefs.setLaunchSelection(CH_A, { level: "full", messages: "auto_both" });
  assert.deepEqual(m.prefs.getLaunchPosture(CH_A), { tools: "bypass", messages: "auto_both" });
  m.setChannelRuntime(CH_A, "codex");
  assert.deepEqual(m.prefs.getLaunchPosture(CH_A), { tools: "never", messages: "auto_both" });
  assert.deepEqual(m.prefs.launchStartModes(CH_A).native, { sandbox_mode: "danger-full-access" });
  m.setChannelRuntime(CH_A, "claude");
  assert.deepEqual(m.prefs.launchStartModes(CH_A).native, {}, "the runtime with no containment axis gets no bag");
});

test("REGRESSION 2026-09-25: a stored bypass/auto_both channel with NO Codex record launches Codex at Full access", () => {
  // The live bug: the channel held the Claude-era `bypass`, an absent Codex record read as
  // `untrusted`, and a Codex launch ran untrusted/workspace-write while the UI showed bypass.
  const m = load({ disk: { channelLaunchSelection: { [CH_A]: {
    v: 2, runtime: "", messages: "auto_both", byRuntime: { claude: { tools: "bypass" } },
  } } } });
  assert.deepEqual(m.prefs.launchStartModes(CH_A, "codex"), {
    tools: "never", messages: "auto_both", native: { sandbox_mode: "danger-full-access" },
  });
  assert.equal(m.prefs.launchPostureFor(CH_A, "codex").level, "full");
  assert.deepEqual(m.prefs.getLaunchSelectionDetail(CH_A).review, []);
  // Reading never wrote; the next write persists the migrated v3 record, and it is idempotent.
  assert.equal(m.disk.channelLaunchSelection[CH_A].v, 2);
  m.prefs.setLaunchSelection(CH_A, { messages: "auto_both" });
  assert.deepEqual(m.disk.channelLaunchSelection[CH_A], { v: 3, runtime: "", messages: "auto_both", level: "full", byRuntime: {} });
});

test("NOTHING ever chosen still fails closed to Ask — on Codex that is the app's own Ask pair, not a wider one", () => {
  const m = load();
  assert.equal(m.prefs.hasLaunchPosture(CH_A), false);
  assert.equal(m.prefs.launchPostureFor(CH_A, "codex").level, "ask");
  assert.deepEqual(m.prefs.launchStartModes(CH_A, "codex"), { tools: "on-request", messages: "auto_inbound", native: { sandbox_mode: "workspace-write" } });
  assert.equal(m.prefs.launchStartModes(CH_A, "claude").tools, "manual");
});

test("an explicit Codex record survives migration for Codex; a level write replaces it", () => {
  const m = load({ disk: { channelLaunchSelection: { [CH_A]: {
    v: 2, runtime: "", messages: "ask",
    byRuntime: { claude: { tools: "bypass" }, codex: { tools: "untrusted", model: "gpt-5-codex", native: { reasoningEffort: "high" } } },
  } } } });
  assert.equal(m.prefs.launchStartModes(CH_A, "codex").tools, "on-request", "Codex stays at Ask (its own explicit choice)");
  assert.equal(m.prefs.launchStartModes(CH_A, "claude").tools, "bypass");
  m.prefs.setLaunchSelection(CH_A, { level: "auto" });
  assert.deepEqual(m.prefs.getLaunchSelection(CH_A).byRuntime, {}, "the one control governs every runtime");
});

test("a per-runtime word in a write is REFUSED whole (an older renderer), and nothing is stored", () => {
  const m = load();
  const res = m.prefs.setLaunchSelection(CH_A, { tools: "bypass", messages: "auto_both" });
  assert.equal(res.ok, false);
  assert.match(res.rejected.join(), /no longer stored/);
  assert.equal(m.disk.channelLaunchSelection, undefined);
});

test("a pre-U5 record migrates its default-runtime tools into the level, on first read", () => {
  const m = load({
    disk: {
      channelLaunchPosture: { [CH_A]: { tools: "bypass", messages: "auto_both", model: "claude-opus-5" } },
      channelRuntime: { [CH_A]: "codex" },
    },
  });
  assert.equal(m.getChannelRuntime(CH_A), "codex", "the separately stored pick is carried over");
  assert.equal(m.prefs.getLaunchSelection(CH_A).level, "full");
  assert.equal(m.prefs.launchStartModes(CH_A).tools, "never");
  // Reading never wrote: a machine that only launches keeps both legacy records untouched.
  assert.equal(m.disk.channelLaunchSelection, undefined);
  assert.deepEqual(m.disk.channelRuntime, { [CH_A]: "codex" });
});

test("a WRITE leaves both legacy records untouched — they are a migration source only (P3-13)", () => {
  const legacy = { [CH_A]: { tools: "manual", messages: "ask" } };
  const m = load({ disk: { channelLaunchPosture: legacy, channelRuntime: { [CH_A]: "claude", [CH_B]: "cursor" } } });
  m.prefs.setLaunchSelection(CH_A, { runtime: "codex", level: "full", messages: "auto_both" });
  assert.deepEqual(m.disk.channelLaunchPosture, legacy);
  assert.deepEqual(m.disk.channelRuntime, { [CH_A]: "claude", [CH_B]: "cursor" });
  assert.equal(m.getChannelRuntime(CH_A), "codex", "the selection record is the authority once written");
});

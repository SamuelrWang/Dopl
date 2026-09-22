// WHAT DOPL READS OFF `model/list` (U6, 2026-09-21) — `main/runtime/codex/models.js`.
//
// THE TWO PROPERTIES THIS FILE EXISTS FOR:
//
//   1. **EVERY MEASURED FIELD SURVIVES** — `id`, `displayName`, `isDefault`, `hidden`,
//      `supportedReasoningEfforts` and `defaultReasoningEffort`, in the SERVER'S OWN ORDER, with a
//      cursor followed and a bound on the loop. The plan lists those names; entry D of its
//      Implementation Log is where they were measured.
//   2. 🔒 **A ROSTER THAT CANNOT BE READ SAYS SO.** It used to answer an EMPTY LIST on every
//      failure, which a picker cannot tell apart from a platform with no models. Every failure
//      path below is asserted to carry the binary's own reason AND to contain none of the default
//      runtime's model ids.
//
// The four STATES built on top of this reader — loading / ready / unavailable / stale — are
// `test/runtime-model-catalog.test.mjs`'s subject. The harness is shared.
//
// Run: `node --test dopl-desktop-app/test/codex-model-list.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadCatalog, loadCodexModels, fakeClient, row, noClaude, CODEX_DESCRIPTOR,
} from "./_model-catalog-harness.mjs";

// ── 1. THE HAPPY PATH ────────────────────────────────────────────────────────────────────────

test("the roster keeps the server's ORDER and marks EXACTLY the reported default", async () => {
  const codex = loadCodexModels(fakeClient([
    { data: [row("gpt-z"), row("gpt-a", { isDefault: true }), row("gpt-m")], nextCursor: null },
  ]));
  const roster = await codex.models();
  assert.deepEqual(roster.ids, ["gpt-z", "gpt-a", "gpt-m"], "the server's order, un-sorted");
  const catalog = loadCatalog().catalogFromRoster("codex", CODEX_DESCRIPTOR, roster);
  assert.equal(catalog.status, "ready");
  assert.deepEqual(catalog.models.map((m) => m.id), ["gpt-z", "gpt-a", "gpt-m"]);
  assert.equal(catalog.defaultId, "gpt-a");
  assert.equal(catalog.models.filter((m) => m.isDefault).length, 1, "exactly one default");
});

test("every MEASURED field survives: displayName, isDefault, hidden, and the effort pair", async () => {
  const codex = loadCodexModels(fakeClient([
    {
      data: [
        row("gpt-a", { isDefault: true, displayName: "GPT Alpha" }),
        row("gpt-secret", { hidden: true }),
      ],
      nextCursor: null,
    },
  ]));
  const catalog = loadCatalog().catalogFromRoster("codex", CODEX_DESCRIPTOR, await codex.models());
  const [alpha, secret] = catalog.models;
  assert.equal(alpha.label, "GPT Alpha", "displayName → label");
  assert.equal(alpha.isDefault, true);
  assert.equal(alpha.hidden, false);
  // ⚠ CARRIED, NOT DROPPED: a session already on a hidden model still has to be LABELLED. Keeping
  // it OUT OF A PICKER is the renderer's `selectableModels`, not a missing row here.
  assert.equal(secret.hidden, true, "a hidden model is carried so it can still be named");
  assert.deepEqual(
    alpha.dimensions.reasoningEffort.options.map((o) => o.value),
    ["low", "medium", "high"],
    "supportedReasoningEfforts → per-model options"
  );
  assert.equal(alpha.dimensions.reasoningEffort.options[0].description, "fast");
  assert.equal(alpha.dimensions.reasoningEffort.default, "medium", "defaultReasoningEffort");
});

test("efforts are PER MODEL — a model that supports fewer gets fewer, and one with none gets none", async () => {
  const codex = loadCodexModels(fakeClient([
    {
      data: [
        row("gpt-wide", { isDefault: true }),
        row("gpt-narrow", {
          supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
          defaultReasoningEffort: "high",
        }),
        row("gpt-none", { supportedReasoningEfforts: [], defaultReasoningEffort: "" }),
      ],
      nextCursor: null,
    },
  ]));
  const catalog = loadCatalog().catalogFromRoster("codex", CODEX_DESCRIPTOR, await codex.models());
  const by = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
  assert.equal(by["gpt-wide"].dimensions.reasoningEffort.options.length, 3);
  assert.deepEqual(by["gpt-narrow"].dimensions.reasoningEffort.options.map((o) => o.value), ["high"]);
  // ⚠ ABSENT, NOT EMPTY — a dimension with no options is a control that writes nowhere (F-390).
  assert.equal(by["gpt-none"].dimensions.reasoningEffort, undefined);
});

test("an effort this build cannot STORE is dropped, not offered", async () => {
  // The descriptor's `dimensionOptions.reasoningEffort` is the closed set main can persist; a
  // server naming something outside it would render a control that writes nowhere.
  const codex = loadCodexModels(fakeClient([
    {
      data: [row("gpt-a", {
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: "low" }, { reasoningEffort: "telepathic" },
        ],
      })],
      nextCursor: null,
    },
  ]));
  const catalog = loadCatalog().catalogFromRoster("codex", CODEX_DESCRIPTOR, await codex.models());
  assert.deepEqual(catalog.models[0].dimensions.reasoningEffort.options.map((o) => o.value), ["low"]);
});

test("a cursor is FOLLOWED, and a server that never advances it does not loop forever", async () => {
  const codex = loadCodexModels(fakeClient([
    { data: [row("p1")], nextCursor: "c1" },
    { data: [row("p2", { isDefault: true })], nextCursor: null },
  ]));
  const roster = await codex.models();
  assert.deepEqual(roster.ids, ["p1", "p2"], "both pages");

  assert.equal(roster.truncated, false, "the server said there was no more");

  // A server that answers the same cursor forever: Dopl notices on the SECOND read and stops.
  const stuck = fakeClient([{ data: [row("p1", { isDefault: true })], nextCursor: "same" }]);
  const roster2 = await loadCodexModels(stuck).models();
  assert.equal(stuck.asked.filter(([m]) => m === "model/list").length, 2, "it does not loop");
  // ⚠ `truncated` MEANS "DOPL STOPPED", so a defensive stop reports one — a picker must not
  // quietly claim to know every model when it gave up on the list.
  assert.equal(roster2.truncated, true);

  // A genuinely endless cursor stops at the page cap, and says so too.
  const endless = {
    ...fakeClient([]),
    connect: () => {
      let n = 0;
      return {
        close: () => {},
        request: async (method) => {
          if (method === "initialize") return {};
          n += 1;
          return { data: [row(`p${n}`, { isDefault: n === 1 })], nextCursor: `c${n}` };
        },
      };
    },
  };
  const roster3 = await loadCodexModels(endless).models();
  assert.equal(roster3.ids.length, 10, "MAX_PAGES");
  assert.equal(roster3.truncated, true);
});

// ── 2. THE FAILURE PATHS — `unavailable`, NEVER "NO MODELS", NEVER ANOTHER VENDOR'S LIST ─────

test("a roster that cannot be READ is `unavailable` WITH THE BINARY'S REASON — never an empty list", async () => {
  const catalog = loadCatalog();
  const cases = [
    [fakeClient([], { probeOk: false, probeReason: "`codex` is not installed where Dopl can find it." }), /not installed/],
    // 🔒 THE `--ignore-user-config` CASE. The flag is dead on the measured CLI and BOTH this file
    // and `launch-spec.js` still pass it, so `initialize` never answers. The flag is U4's to
    // change; what U6 owes is that the failure READS as one.
    [fakeClient([], { initializeRejects: "unexpected argument '--ignore-user-config' found" }), /ignore-user-config/],
    [fakeClient([], { listRejects: "method not found" }), /method not found/],
    [fakeClient([], { connectThrows: "spawn EACCES" }), /EACCES/],
    [fakeClient([{ data: [] }]), /no models/i],
  ];
  for (const [client, pattern] of cases) {
    const roster = await loadCodexModels(client).models();
    const c = catalog.catalogFromRoster("codex", CODEX_DESCRIPTOR, roster);
    assert.equal(c.status, "unavailable", String(pattern));
    assert.match(c.reason, pattern);
    assert.deepEqual(c.models, [], "a failure carries no models");
    assert.equal(c.defaultId, null);
    noClaude(c, String(pattern));
  }
});

// ── 4. THE CACHE KEY IS THE RESOLVED BINARY AND ITS VERSION ──────────────────────────────────

test("the roster is cached by BINARY AND VERSION, and a change re-reads", async () => {
  let version = "codex-cli 1.0.0";
  let path = "/opt/homebrew/bin/codex";
  let calls = 0;
  const client = {
    probe: async () => ({ ok: true, reason: "", version, path, source: "path" }),
    initializeParams: () => ({}),
    catalogGate: () => ({ ok: true, reason: "" }),
    connect: () => ({
      close: () => {},
      request: async (method) => {
        if (method === "initialize") return {};
        calls += 1;
        return { data: [row(`gpt-${calls}`, { isDefault: true })] };
      },
    }),
  };
  const codex = loadCodexModels(client);
  assert.equal((await codex.models()).key, "/opt/homebrew/bin/codex@codex-cli 1.0.0");
  await codex.models();
  assert.equal(calls, 1, "the same binary at the same version is read once");

  version = "codex-cli 2.0.0";
  assert.deepEqual((await codex.models()).ids, ["gpt-2"], "an upgrade re-reads");
  path = "/usr/local/bin/codex";
  assert.deepEqual((await codex.models()).ids, ["gpt-3"], "a different binary re-reads");
});

test("a FAILED read is NOT cached — an operator who fixes their install with Dopl open recovers", async () => {
  let installed = false;
  let calls = 0;
  const client = {
    probe: async () => (installed
      ? { ok: true, reason: "", version: "codex-cli 1.0.0", path: "/opt/homebrew/bin/codex" }
      : { ok: false, reason: "`codex` is not installed where Dopl can find it.", version: null, path: null }),
    initializeParams: () => ({}),
    catalogGate: () => ({ ok: true, reason: "" }),
    connect: () => ({
      close: () => {},
      request: async (method) => {
        if (method === "initialize") return {};
        calls += 1;
        return { data: [row("gpt-a", { isDefault: true })] };
      },
    }),
  };
  const codex = loadCodexModels(client);
  assert.match((await codex.models()).reason, /not installed/);
  installed = true;
  assert.deepEqual((await codex.models()).ids, ["gpt-a"], "it recovers without a restart");
  assert.equal(calls, 1);
});

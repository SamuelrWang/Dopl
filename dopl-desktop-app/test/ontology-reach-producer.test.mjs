// THE PRODUCER FOR `ctx.ontologies` (2026-09-09, F-681).
//
// `ontology-reach-framing.test.mjs` covers the RENDER — what the block says once
// the field exists. This file covers the half that did not exist: WHO WRITES IT.
// The module shipped on 2026-09-09 reading a field nothing in `main/` ever set,
// so its eight framing cases all exercised data only the tests supplied.
//
// Three things are asserted and they are different questions:
//   THE MODULE   `main/ontology-reach.js › fetchOntologyReach` — the credential it
//                presents, and that EVERY failure degrades to `[]` rather than
//                throwing into a spawn.
//   THE WIRING   `main/session-launch.js › launch` — that the ONE spawn funnel
//                awaits it and merges the answer onto `context`, and that a lane
//                reaching nothing is handed the caller's own object unchanged.
//   THE JOIN     the producer's output through the REAL `ontologyReachLines`,
//                because two correct halves with mismatched field names is
//                exactly the defect F-681 was.
//
// ⚠ IT IS ENRICHMENT AND NEVER A GATE (INVARIANTS §4A). Nothing here asserts that
// a missing block stops a read; the fence is `ontology/server/service-audience.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const { ontologyReachLines } = require_(join(MAIN, "prompt-framing-ontology.js"));

/**
 * The real module over stubbed seams. ⚠ `./api`, `./mcp-config` and `./diag` are
 * required LAZILY inside the function precisely so this is possible under
 * `node --test`: all three reach electron.
 */
function boot(cfg = {}) {
  const calls = { fetches: [], diag: [] };
  const stub = (id) => {
    if (id === "./diag") return { diag: (...a) => calls.diag.push(a.join(" ")) };
    if (id === "./mcp-config") {
      return { deviceTokenForSpawn: () => (cfg.token === undefined ? "dopl_at_tok" : cfg.token) };
    }
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          calls.fetches.push({ path, opts });
          if (cfg.throws) throw new Error("socket died");
          if (cfg.status && cfg.status !== 200) return { ok: false, status: cfg.status };
          return { ok: true, status: 200, json: async () => cfg.body ?? { ontologies: [] } };
        },
      };
    }
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", read("ontology-reach.js"))(
    stub, mod, mod.exports
  );
  return { ...mod.exports, calls };
}

const ONE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sales",
  level: "edit",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};

// ── THE MODULE ───────────────────────────────────────────────────────────────

test("the happy path: the CHANNEL's container, the AGENT bearer, and the narrowed list", async () => {
  const m = boot({ body: { ontologies: [ONE] } });
  const out = await m.fetchOntologyReach("ws-link");
  assert.deepEqual(out, [ONE]);
  const [call] = m.calls.fetches;
  assert.equal(call.path, "/api/ontology/reach");
  // ⚠ THE CONTAINER, not "the operator's active workspace" — `apiFetch` sends it
  // as `X-Workspace-Id`, and a launch into a home channel reads THAT container.
  assert.equal(call.opts.workspaceId, "ws-link");
  // 🔒 THE BEARER IS THE WHOLE CORRECTNESS ARGUMENT: `buildOntologyContext`
  // derives `source` from an agent token, and the OWNER's own agent is the one
  // matrix row that is not simply its human's. A cookie-only read would answer
  // the OPERATOR's rung and the block would promise EDIT on a refused lane.
  assert.equal(call.opts.headers.Authorization, "Bearer dopl_at_tok");
  assert.equal(call.opts.noStore, true);
  assert.equal(typeof call.opts.timeoutMs, "number");
});

test("🔒 NO agent credential ⇒ `[]` and NO request — never a cookie fallback", async () => {
  const m = boot({ token: "" });
  assert.deepEqual(await m.fetchOntologyReach("ws-link"), []);
  assert.equal(m.calls.fetches.length, 0);
  assert.match(m.calls.diag.join("\n"), /no agent credential/);
});

test("no workspace id ⇒ `[]` and no request", async () => {
  const m = boot();
  assert.deepEqual(await m.fetchOntologyReach(null), []);
  assert.deepEqual(await m.fetchOntologyReach(""), []);
  assert.equal(m.calls.fetches.length, 0);
});

for (const [label, cfg] of [
  ["a 500", { status: 500 }],
  ["an older deployment's 404", { status: 404 }],
  ["a dead socket / the timeout", { throws: true }],
  ["a body that is not an object", { body: null }],
  ["a body with no `ontologies` array", { body: { items: [] } }],
]) {
  test(`⚠ ENRICHMENT, NOT AN IDENTITY — ${label} degrades to [] and never throws`, async () => {
    const m = boot(cfg);
    assert.deepEqual(await m.fetchOntologyReach("ws-link"), []);
  });
}

test("the boundary NARROWS: a non-string field blanks, and the list is capped", async () => {
  const m = boot();
  // ⚠ Blanked, not dropped, here — `prompt-framing-ontology.js › reachable` is
  // where the DROP happens, on the empty result, and it is the module with the
  // sanitizers. This half only guarantees the shape.
  assert.deepEqual(m.narrow([{ id: 1, name: null, level: "edit", workspaceId: undefined }]), [
    { id: "", name: "", level: "edit", workspaceId: "" },
  ]);
  assert.deepEqual(m.narrow("not a list"), []);
  const many = Array.from({ length: m.MAX_ONTOLOGIES + 10 }, () => ONE);
  assert.equal(m.narrow(many).length, m.MAX_ONTOLOGIES);
});

// ── THE WIRING ───────────────────────────────────────────────────────────────

test("the ONE spawn funnel awaits it — all three launch lanes, not one of them", () => {
  // ⚠ SOURCE, because the property IS the source: `session-launch.js` is the
  // funnel the button, the directive and the peer-triggered responder all reach,
  // and F-510 is the scar from a rule spelled at one lane only.
  const src = read("session-launch.js");
  assert.match(src, /require\('\.\/ontology-reach'\)/);
  assert.match(src, /const ontologies = await ontologyReach\.fetchOntologyReach\(a\.workspaceId\);/);
  // ⚠ **THE KEY IS ADDED ONLY WHEN THERE IS SOMETHING TO SAY**, which is the property, not the
  // spelling. It was a one-line ternary until 2026-09-18, when the ROOM ROSTER joined the same
  // funnel for the same reasons (one producer, three lanes, fail-open) and the two facts became
  // an `extra` object — so this pins the CONTRACT both halves keep: a lane that reaches nothing
  // hands `startSession` the caller's own context, unchanged.
  assert.match(src, /if \(ontologies\.length\) extra\.ontologies = ontologies;/);
  assert.match(src, /const context = Object\.keys\(extra\)\.length \? \{ \.\.\.\(a\.context \|\| \{\}\), \.\.\.extra \} : a\.context;/);
  // ⚠ AND NO REFUSAL RIDES IT. A `skipped` branch on this read would take agent
  // launching down over a slow enrichment endpoint.
  assert.equal(/ontologies[\s\S]{0,80}skipped/.test(src), false);
});

// ── THE JOIN ─────────────────────────────────────────────────────────────────

test("the producer's field names are the RENDERER's — the two halves actually meet", () => {
  // 🔒 THIS IS F-681 ITSELF. Both halves were individually correct and nothing
  // connected them, so a mismatch (`clusterId` vs `id`) would have been invisible
  // to every other case in this file and in `ontology-reach-framing.test.mjs`.
  const lines = ontologyReachLines({ ontologies: boot().narrow([ONE]) });
  assert.ok(lines.length > 0, "the block must render from the producer's shape");
  assert.match(lines.join("\n"), /"Sales" \(EDIT\)/);
  assert.match(lines.join("\n"), new RegExp(`cluster "${ONE.id}", workspace "${ONE.workspaceId}"`));
  // …and the empty answer stays byte-identical to the pre-module turn.
  assert.deepEqual(ontologyReachLines({ ontologies: [] }), []);
});

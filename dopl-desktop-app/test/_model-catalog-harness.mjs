// SHARED HARNESS for the two U6 model-catalog suites — `test/codex-model-list.test.mjs` (what
// Dopl READS off `model/list`) and `test/runtime-model-catalog.test.mjs` (the four STATES the
// catalog is allowed to be in, and the cache behind them).
//
// ⚠ ONE HARNESS, NOT TWO, because both suites have to boot the SAME program: a second copy is how
// two suites come to be green over different fakes. The split above is a reason-to-change seam —
// the reader moves when the wire shape does, the state machine when the contract does.
//
// ⚠ NO ELECTRON AND NO CHILD PROCESS. `codex/models.js` is evaluated against a stub `require`
// whose `./client` is a fake app-server — which is what lets the FAILURE paths be driven at all.
// ⚠ IT DOES NOT CLAIM TO KNOW THE LIVE PROTOCOL. The row shape here is the one recorded in the
// plan's Implementation Log entry D (`{ data, nextCursor }`, `supportedReasoningEfforts` as
// `{reasoningEffort, description}` objects, `hidden`), measured from a CLI that is NOT a supported
// source. What the suites pin is that Dopl READS that shape correctly and fails honestly when it
// gets anything else — `test/codex-app-server-contract.test.mjs`'s live tier is the only tier
// allowed to say what the protocol IS.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evalModule } from "./helpers/module-sandbox.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const requireMain = createRequire(import.meta.url);

const evalFile = (path, stub) => evalModule(readFileSync(path, "utf8"), stub);

/** A fresh `model-catalog.js` — the snapshot cache is module-level, so each case gets its own. */
export const loadCatalog = () =>
  evalFile(join(MAIN, "runtime", "model-catalog.js"), (id) => {
    if (id === "./selection-vocabulary") return requireMain(join(MAIN, "runtime", "selection-vocabulary.js")); // pure
    throw new Error(`unexpected require: ${id}`);
  });

/** A fresh `codex/models.js` over a fake app-server. `client` is the whole seam. */
export function loadCodexModels(client) {
  return evalFile(join(MAIN, "runtime", "codex", "models.js"), (id) => {
    if (id === "./client") return client;
    if (id === "./config-home") return { isolatedEnv: (env) => env };
    if (id === "../../app-version") return { appVersion: () => "" };
    throw new Error(`unexpected require: ${id}`);
  });
}

export const claudeModels = requireMain(join(MAIN, "runtime", "claude", "models.js"));

/**
 * THE CLAUDE ADAPTER'S BUILD-TIME TABLE, AS A PLAIN SYNCHRONOUS ROSTER (2026-09-22). The adapter is
 * `live` now (`claude/models.js`), and this table is its FALLBACK — which it marks `stale`. These
 * suites use it as "a runtime with a fixed table" to drive the CONTRACT (inline reads, isolation,
 * labels), so the stale flag is dropped here and the live adapter has its own suite
 * (`claude-live-roster.test.mjs`).
 */
export const claudeTable = () => Object.assign({}, claudeModels.frozenRoster(), { stale: false, source: "frozen" });

/** The four ids that must never appear on another runtime's surface. */
export const CLAUDE_IDS = ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];

export const noClaude = (catalog, which) => {
  for (const id of catalog.models.map((m) => m.id)) {
    assert.equal(CLAUDE_IDS.includes(id), false, `${which}: ${id} leaked onto another runtime`);
  }
};

/** A fake `./client` whose `model/list` answers `pages` in order. */
export function fakeClient(pages, opts = {}) {
  const asked = [];
  return {
    asked,
    probe: async () => ({
      ok: opts.probeOk !== false,
      reason: opts.probeReason || "",
      version: opts.version || "codex-cli 1.2.3",
      path: opts.path || "/opt/homebrew/bin/codex",
      source: "path",
    }),
    initializeParams: () => ({}),
    catalogGate: (rows) => {
      const defaults = (rows || []).filter((r) => r && r.isDefault === true);
      return defaults.length === 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: `the model catalog declares ${defaults.length} defaults` };
    },
    connect: () => {
      if (opts.connectThrows) throw new Error(opts.connectThrows);
      let page = 0;
      return {
        close: () => {},
        notify: (method) => asked.push([method]),
        request: async (method, params) => {
          asked.push([method, params]);
          if (method === "initialize") {
            if (opts.initializeRejects) throw new Error(opts.initializeRejects);
            return {};
          }
          if (method === "model/list") {
            if (opts.listRejects) throw new Error(opts.listRejects);
            const answer = pages[Math.min(page, pages.length - 1)];
            page += 1;
            return answer;
          }
          throw new Error(`unexpected method ${method}`);
        },
      };
    },
  };
}

/** One measured-shape row. */
export const row = (id, extra = {}) => Object.assign({
  id,
  displayName: id.toUpperCase(),
  isDefault: false,
  hidden: false,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "fast" },
    { reasoningEffort: "medium", description: "balanced" },
    { reasoningEffort: "high", description: "thorough" },
  ],
}, extra);

/** A sealed-adapter shim: `model-catalog.js` only ever reads these two members. */
export const adapter = (descriptor, models) => ({ descriptor, runtime: { models } });

export const CODEX_DESCRIPTOR = {
  id: "codex",
  label: "Codex",
  models: { source: "live", dimensions: ["reasoningEffort"] },
};

/** Let the background refresh settle. ⚠ `snapshot()` never awaits; the test must. */
export const settle = () => new Promise((r) => setTimeout(r, 0));

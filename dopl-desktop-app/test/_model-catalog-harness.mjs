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

/** An in-memory `live-store.js` stand-in: same read/save contract, nothing on disk. Pass one to share
 *  "the disk" between two catalog loads (a restart). */
export function memoryLiveStore() {
  const entries = new Map();
  return {
    entries,
    read: (kind, id, key) => {
      const e = entries.get(`${kind}:${id}`);
      return key && e && e.key === key ? JSON.parse(JSON.stringify(e.value)) : null;
    },
    save: (kind, id, key, value) => {
      if (!key || value == null) return false;
      entries.set(`${kind}:${id}`, { key, value: JSON.parse(JSON.stringify(value)) });
      return true;
    },
  };
}

/** A fresh `model-catalog.js` — the snapshot cache is module-level, so each case gets its own. */
export const loadCatalog = (store) =>
  evalFile(join(MAIN, "runtime", "model-catalog.js"), (id) => {
    if (id === "./selection-vocabulary") return requireMain(join(MAIN, "runtime", "selection-vocabulary.js")); // pure
    if (id === "./live-store") return store || memoryLiveStore();
    if (id === "./roster-key") return requireMain(join(MAIN, "runtime", "roster-key.js")); // pure
    if (id === "./model-preferences") return requireMain(join(MAIN, "runtime", "model-preferences.js")); // seed + lazy store
    throw new Error(`unexpected require: ${id}`);
  });

/** A fresh `codex/models.js` over a fake app-server. `client` is the whole seam. */
export function loadCodexModels(client) {
  return evalFile(join(MAIN, "runtime", "codex", "models.js"), (id) => {
    if (id === "./client") return client;
    if (id === "./config-home") return { isolatedEnv: (env) => env };
    if (id === "../cli-spawn") return requireMain(join(MAIN, "runtime", "cli-spawn.js"));
    if (id === "../../app-version") return { appVersion: () => "" };
    throw new Error(`unexpected require: ${id}`);
  });
}

export const claudeModels = requireMain(join(MAIN, "runtime", "claude", "models.js"));

const claudeRoster = requireMain(join(MAIN, "runtime", "claude", "roster.js"));

/**
 * ⚠ MEASURED 2026-10-08 on runtime 0.3.293 (signed in): Claude Code's own `supportedModels()` rows —
 * its current aliases plus its "older models" pinned by id. The adapter keeps no table (2026-10-08,
 * SDK resilience #2), so the suites drive the catalog CONTRACT off this real answer instead.
 */
export const MEASURED_293 = [
  ["default", "claude-opus-5-5", "Default (recommended)"], ["opus", "claude-opus-5-5", "Opus 5.5"],
  ["fable", "claude-fable-5-1", "Fable 5.1"], ["sonnet", "claude-sonnet-5-5", "Sonnet 5.5"],
  ["haiku", "claude-haiku-5-5", "Haiku 5.5"], ["claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001", "Haiku 4.5"],
  ["claude-sonnet-5", "claude-sonnet-5", "Sonnet 5"], ["claude-opus-5", "claude-opus-5", "Opus 5"],
  ["claude-fable-5", "claude-fable-5", "Fable 5"], ["claude-opus-4-8", "claude-opus-4-8", "Opus 4.8"],
  ["claude-opus-4-7", "claude-opus-4-7", "Opus 4.7"], ["claude-opus-4-6", "claude-opus-4-6", "Opus 4.6"],
  ["claude-sonnet-4-6", "claude-sonnet-4-6", "Sonnet 4.6"],
].map(([value, resolvedModel, displayName]) => ({ value, resolvedModel, displayName }));

/** The measured answer as the adapter's roster (a plain synchronous roster for the contract suites). */
export const claudeTable = () => claudeRoster.rosterFrom(MEASURED_293, { fallbackAlias: "sonnet" });

/** Every Claude id in that roster: none may ever appear on another runtime's surface. */
export const CLAUDE_IDS = claudeTable().ids;

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

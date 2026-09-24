/**
 * The granular manifest against the LIVE legacy surface: every legacy key bound exactly once, no
 * delete op, annotations that match the write gate, and the naming rules (the retired ontology word
 * is `src/features/ontology/vocabulary.test.ts`'s, repo-wide). Legacy keys come from the
 * captured registrars, write ops from `gating.ts`'s source text — never from the manifest itself.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DoplClient } from "@dopl/client";

import {
  DELETE_BLOCKED_OPS,
  TOOL_BY_NAME,
  WRITE_OPS,
  classifies,
  gateKeys,
  opEnum,
  servesKey,
  type CapturedTool,
} from "./tools/parity-harness.js";
import { registerStatusTool } from "./tools/status.js";
import type { RegisterMetaTool } from "./tools/respond.js";
import type { WorkspaceDirectory } from "./workspace-directory.js";
import {
  GRANULAR_TOOLS,
  annotationsFor,
  bindingsOf,
  bindsDeleteOp,
  LEGACY_TOOL_NAMES,
  parseBinding,
  selectorOf,
} from "./tool-manifest.js";
import { UNCOVERED_ACTIONS } from "./tool-manifest-parity.js";

// `dopl_status` registers through `registerStatusTool`, which the harness does not capture.
const status: CapturedTool[] = [];
registerStatusTool(
  ((name, description, schema) => status.push({ name, description, schema, sourceFile: "status.ts" })) as RegisterMetaTool,
  {} as DoplClient,
  {} as WorkspaceDirectory,
);
const LEGACY = new Map([...TOOL_BY_NAME, ...status.map((t) => [t.name, t] as const)]);

const LEGACY_KEYS = [...LEGACY.values()].flatMap((t) => {
  const ops = opEnum(t);
  return ops ? gateKeys(t, ops).map((k) => `${t.name}:${k}`) : [t.name];
});

const VERBS = new Set([
  "get", "list", "read", "search", "browse", "create", "update", "write", "edit", "send",
  "request", "invite", "launch", "manage", "save", "restore",
]);

describe("tool manifest", () => {
  it("is 39 uniquely named verb_noun tools", () => {
    const names = GRANULAR_TOOLS.map((t) => t.name);
    expect(names).toHaveLength(39);
    expect(new Set(names).size).toBe(names.length);
    const bad = names.filter((n) => !/^dopl_[a-z]+(_[a-z]+)*$/.test(n) || !VERBS.has(n.split("_")[1]));
    expect(bad).toEqual([]);
  });

  it("binds every legacy key exactly once (presets aside) and nothing that is not one", () => {
    const counts = new Map(LEGACY_KEYS.map((k) => [k, 0]));
    const unknown: string[] = [];
    for (const t of GRANULAR_TOOLS) {
      for (const key of bindingsOf(t)) {
        const { tool, op } = parseBinding(key);
        const legacy = LEGACY.get(tool);
        const ops = legacy && opEnum(legacy);
        const real = legacy !== undefined && (op === undefined ? ops === null : !!ops && servesKey(tool, ops, op));
        if (!real) unknown.push(`${t.name} → ${key}`);
        if (!t.preset) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect(unknown).toEqual([]);
    expect([...counts].filter(([, n]) => n !== 1)).toEqual([]);
  });

  it("presets fix a legacy arg on a key another tool already serves", () => {
    for (const t of GRANULAR_TOOLS.filter((g) => g.preset)) {
      for (const key of bindingsOf(t)) {
        const schema = LEGACY.get(parseBinding(key).tool)!.schema;
        expect(Object.keys(t.preset!).filter((arg) => !(arg in schema)), t.name).toEqual([]);
        expect(t.params.filter((p) => p in t.preset!), t.name).toEqual([]);
      }
    }
  });

  it("names no delete op", () => {
    expect(GRANULAR_TOOLS.filter(bindsDeleteOp).map((t) => t.name)).toEqual([]);
    const blocked = Object.entries(DELETE_BLOCKED_OPS).flatMap(([tool, ops]) => [...ops].map((op) => `${tool}:${op}`));
    expect(GRANULAR_TOOLS.flatMap(bindingsOf).filter((k) => blocked.includes(k.split(".")[0]))).toEqual([]);
  });

  it("is read-only exactly where no bound key is a gated write", () => {
    for (const t of GRANULAR_TOOLS) {
      const writes = bindingsOf(t).some((key) => {
        const { tool, op } = parseBinding(key);
        return op !== undefined && !!WRITE_OPS[tool] && classifies(WRITE_OPS[tool], op);
      });
      const a = annotationsFor(t);
      expect(a.readOnlyHint, t.name).toBe(!writes);
      expect(a.openWorldHint, t.name).toBe(false);
      if (!writes) expect([t.destructive, t.idempotent], `${t.name} is a read`).toEqual([undefined, undefined]);
    }
    expect(GRANULAR_TOOLS.filter((t) => annotationsFor(t).readOnlyHint)).toHaveLength(21);
  });

  it("publishes only args its legacy tools accept, and one selector where it does several jobs", () => {
    for (const t of GRANULAR_TOOLS) {
      const accepted = new Set(bindingsOf(t).flatMap((k) => Object.keys(LEGACY.get(parseBinding(k).tool)!.schema)));
      expect(t.params.filter((p) => !accepted.has(p) || p === "op" || p === "container"), t.name).toEqual([]);
      const selector = selectorOf(t);
      if (selector) expect(t.params, t.name).not.toContain(selector);
      else expect(t.select, t.name).toBeUndefined();
    }
  });

  it("a selector default names one of its jobs, and only on a name the legacy set also uses", () => {
    for (const t of GRANULAR_TOOLS.filter((g) => g.selectDefault !== undefined)) {
      expect(Object.keys(t.bind), t.name).toContain(t.selectDefault);
      expect(LEGACY_TOOL_NAMES.has(t.name), t.name).toBe(true);
    }
  });

  it("keeps eight core tools loaded; the rest may defer", () => {
    expect(GRANULAR_TOOLS.filter((t) => t.alwaysLoad)).toHaveLength(8);
  });

  it("classifies only product actions that exist", () => {
    const api = path.resolve(process.cwd(), "../../src/app/api");
    const missing = UNCOVERED_ACTIONS.flatMap(([action]) => {
      const [methods, route] = action.split(" ");
      const file = path.join(api, route, "route.ts");
      if (!existsSync(file)) return [action];
      const src = readFileSync(file, "utf8");
      return methods
        .split(",")
        .filter((m) => !new RegExp(`export (const|async function|function) ${m}\\b`).test(src))
        .map((m) => `${m} ${route}`);
    });
    expect(missing).toEqual([]);
    expect(new Set(UNCOVERED_ACTIONS.map(([a]) => a)).size).toBe(UNCOVERED_ACTIONS.length);
  });
});

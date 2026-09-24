/**
 * NO HAND-WRITTEN CALL SPELLING (DMP-013). Every string literal in `src` is scanned: a legacy tool
 * name (`dopl_kb`) or an `op=` arg is allowed only in legacy-only text — a legacy tool's description
 * (`composeDescription`), a legacy param's `.describe()`, the `legacy` branch of a `bySet`, or text a
 * file wraps in `legacyOnly` — and in the renderer, the manifest and test support. Everything else
 * spells through `call-ref.ts`, and the granular half of the sweep (`surface-sweep.ts`) proves what a
 * granular connection reads names granular tools only.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { callKeys } from "./call-ref.js";
import { GRANULAR_TOOL_NAMES, LEGACY_TOOL_NAMES } from "./tool-manifest.js";
import { sweep } from "./surface-sweep.js";

const SRC = import.meta.dirname;

/** Where a raw spelling is the point: the renderer, the manifest, test support. */
const ALLOWED_FILES = new Set([
  "call-ref.ts",
  "tool-manifest.ts",
  "tool-manifest-parity.ts",
  "surface-sweep.ts",
  "law-shipped-prose.ts",
  "parity-harness.ts",
]);
/** A legacy tool named bare: `dopl_search` is in both sets, so it is not one. */
const LEGACY_NAME = new RegExp(`\\b(${[...LEGACY_TOOL_NAMES].filter((n) => !GRANULAR_TOOL_NAMES.has(n)).join("|")})\\b`);
const OP_ARG = /\bop=/;
/** Legacy-only text: a legacy description, a legacy param's describe, a `legacyOnly` wrap. */
const LEGACY_ONLY_CALLS = new Set(["describe", "composeDescription", "legacyOnly"]);

const calleeName = (call: ts.CallExpression) =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : "";

/** `bySet({ legacy: … })`: that branch renders on a legacy connection only. */
const isBySetLegacyBranch = (n: ts.Node) =>
  ts.isPropertyAssignment(n) &&
  n.name.getText() === "legacy" &&
  ts.isCallExpression(n.parent.parent) &&
  calleeName(n.parent.parent) === "bySet";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.includes("fixture") ? [full] : [];
  });
}

function insideLegacyOnly(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (isBySetLegacyBranch(n) || (ts.isCallExpression(n) && LEGACY_ONLY_CALLS.has(calleeName(n)))) return true;
  }
  return false;
}

function rawSpellings(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node);
    // A literal that IS a tool name is an identifier (a registration, a gate table), not prose.
    const prose = literal && !LEGACY_TOOL_NAMES.has(node.text);
    if (prose && (LEGACY_NAME.test(node.text) || OP_ARG.test(node.text)) && !insideLegacyOnly(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      hits.push(`${path.relative(SRC, file)}:${line + 1}: ${node.text.slice(0, 90).replace(/\n/g, " ")}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("no hand-written call spelling", () => {
  it("outside callRef, the manifest and legacy-only text", () => {
    const hits = sourceFiles(SRC)
      .filter((f) => !ALLOWED_FILES.has(path.basename(f)))
      .flatMap(rawSpellings);
    expect(hits).toEqual([]);
  });

  it("every literal key handed to callRef/toolName is a manifest key", () => {
    const keys = callKeys();
    const used = sourceFiles(SRC).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\b(?:callRef|toolName|opRef)\("([a-z_.]+)"/g)].map((m) => m[1]),
    );
    expect(used.length).toBeGreaterThan(0);
    // An op without its action (`channel.manage`) names every job under it.
    const known = (k: string) => keys.has(k) || [...keys].some((key) => key.startsWith(`${k}.`));
    expect(used.filter((k) => !known(k))).toEqual([]);
  });
});

describe("a granular connection names granular tools only", async () => {
  const cases = await sweep();

  it.each(cases.map((c) => [c.label, c.granular.text] as const))("%s", (_label, text) => {
    expect(text).not.toMatch(LEGACY_NAME);
    expect(text).not.toMatch(OP_ARG);
  });
});

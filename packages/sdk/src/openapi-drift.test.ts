/**
 * Drift gate: every path + method in the package's own spec copy (`spec/openapi.yaml`) has an SDK method in
 * `ROUTES`, and every `ROUTES` entry is in the spec. A route added to the spec without a client
 * method fails CI here.
 *
 * The parse is deliberately small (no YAML dependency): under `paths:`, a two-space-indented
 * `/…:` line opens a path and a four-space-indented HTTP verb line names a method.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Dopl, ROUTES } from "./index.js";

const SPEC = join(dirname(fileURLToPath(import.meta.url)), "../spec/openapi.yaml");
const VERBS = new Set(["get", "post", "put", "patch", "delete"]);

function specOperations(yaml: string): string[] {
  const ops: string[] = [];
  let inPaths = false;
  let path: string | null = null;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith("paths:");
      path = null;
      continue;
    }
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1];
      continue;
    }
    const m = /^ {4}([a-z]+):\s*$/.exec(line);
    if (m && path && VERBS.has(m[1])) ops.push(`${m[1].toUpperCase()} ${path}`);
  }
  return ops.sort();
}

describe("openapi.yaml and the SDK agree", () => {
  const ops = specOperations(readFileSync(SPEC, "utf8"));

  it("parses the spec's operations", () => {
    expect(ops.length).toBeGreaterThanOrEqual(9);
  });

  it("every spec operation has an SDK method and no SDK route is missing from the spec", () => {
    const sdk = Object.values(ROUTES)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(sdk).toEqual(ops);
  });

  it("every ROUTES key names a real method on the client", () => {
    const dopl = new Dopl({ apiKey: "sk_test_EXAMPLE00000000000000" }) as unknown as Record<string, Record<string, unknown>>; // gitleaks:allow (documented fake)
    for (const key of Object.keys(ROUTES)) {
      const [group, method] = key.split(".");
      expect(typeof dopl[group]?.[method], key).toBe("function");
    }
  });
});

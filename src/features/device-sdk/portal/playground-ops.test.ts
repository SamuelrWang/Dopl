import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_IN_PLAYGROUND, PLAYGROUND_OPS, fillPath, playgroundOp } from "./playground-ops";

/** `operationId → "METHOD /path"` from the spec: a path line, a verb line, then its operationId. */
function specOperations(): Map<string, string> {
  const yaml = readFileSync(join(process.cwd(), "docs/specs/device-sdk/openapi.yaml"), "utf8");
  const ops = new Map<string, string>();
  let inPaths = false;
  let path: string | null = null;
  let verb: string | null = null;
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith("paths:");
      continue;
    }
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1];
      continue;
    }
    const v = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (v) {
      verb = v[1].toUpperCase();
      continue;
    }
    const id = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (id && path && verb) ops.set(id[1], `${verb} ${path}`);
  }
  return ops;
}

describe("playground operations", () => {
  const spec = specOperations();

  it("parses the spec", () => {
    expect(spec.size).toBeGreaterThanOrEqual(10);
  });

  it("every row is a spec operation, method and path exact", () => {
    for (const op of PLAYGROUND_OPS) expect(spec.get(op.id), op.id).toBe(`${op.method} ${op.path}`);
  });

  it("every spec operation is a row or excluded with a reason", () => {
    const covered = new Set([...PLAYGROUND_OPS.map((o) => o.id), ...Object.keys(NOT_IN_PLAYGROUND)]);
    expect([...spec.keys()].filter((id) => !covered.has(id))).toEqual([]);
  });

  it("path params name exactly the path's placeholders, in order", () => {
    for (const op of PLAYGROUND_OPS) {
      const holes = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(op.pathParams.map((p) => p.name), op.id).toEqual(holes);
    }
  });
});

describe("fillPath", () => {
  const action = playgroundOp("createDeviceAction")!;

  it("fills and encodes every placeholder", () => {
    expect(fillPath(action, { device_id: "dev_1", capability: "present.notify" })).toEqual({
      ok: true,
      path: "/devices/dev_1/actions/present.notify",
    });
  });

  it("refuses a missing, unknown or path-breaking value", () => {
    expect(fillPath(action, { device_id: "dev_1" }).ok).toBe(false);
    expect(fillPath(action, { device_id: "dev_1", capability: "x", extra: "y" }).ok).toBe(false);
    for (const bad of ["../keys", "a/b", "a?b", "a b", "%2e%2e"]) {
      expect(fillPath(action, { device_id: bad, capability: "present.notify" }).ok, bad).toBe(false);
    }
  });
});

/**
 * The generated API reference is the spec's: regenerated from `openapi.yaml` and compared with the
 * committed `openapi-reference.generated.json`. With `UPDATE_API_REFERENCE=1` the test rewrites
 * the file instead (see `openapi-reference.ts`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { buildApiReference, typeOf } from "./openapi-reference";
import { ENDPOINTS, paramDescription, referenceOf } from "./pages-api";

const SPEC = join(process.cwd(), "docs/specs/device-sdk/openapi.yaml");
const OUT = join(process.cwd(), "src/features/marketing/docs/content/openapi-reference.generated.json");

describe("generated API reference", () => {
  const fresh = buildApiReference(load(readFileSync(SPEC, "utf8")));

  it("matches the spec (regenerate with UPDATE_API_REFERENCE=1)", () => {
    const text = `${JSON.stringify(fresh, null, 2)}\n`;
    if (process.env.UPDATE_API_REFERENCE === "1") writeFileSync(OUT, text);
    expect(readFileSync(OUT, "utf8")).toBe(text);
  });

  it("covers every operation once", () => {
    const ids = fresh.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it("reads params, body fields and auth from the spec", () => {
    const connect = fresh.find((o) => o.operationId === "createConnectSession")!;
    expect(connect.auth).toBe("publishable");
    expect(connect.params.find((p) => p.name === "requested_scopes")).toMatchObject({ in: "body", required: true, type: "string[]" });
    expect(connect.params.find((p) => p.name === "branding")).toMatchObject({ type: "ConnectBranding" });
    const events = fresh.find((o) => o.operationId === "listEvents")!;
    expect(events).toMatchObject({ method: "GET", path: "/events", auth: "secret" });
    expect(events.params.map((p) => `${p.in}:${p.name}`)).toContain("query:cursor");
    expect(events.responses.find((r) => r.status === "200")?.schema).toBe("EventListResponse");
  });
});

describe("API reference pages over the generated reference", () => {
  const fresh = buildApiReference(load(readFileSync(SPEC, "utf8")));

  it("has exactly one page per spec operation", () => {
    expect(ENDPOINTS.map((e) => e.op).sort()).toEqual(fresh.map((o) => o.operationId).sort());
    expect(new Set(ENDPOINTS.map((e) => e.slug)).size).toBe(ENDPOINTS.length);
  });

  it("describes only parameters the operation has, and every one it has", () => {
    for (const e of ENDPOINTS) {
      const ref = referenceOf(e.op);
      const names = new Set(ref.params.map((p) => p.name));
      for (const k of Object.keys(e.describe ?? {})) expect(names.has(k), `${e.op}: ${k} is not in the spec`).toBe(true);
      for (const p of ref.params) expect(paramDescription(e, p), `${e.op}: ${p.in} ${p.name} has no description`).toBeTruthy();
    }
  });
});

describe("typeOf", () => {
  it("renders refs, unions, enums and arrays", () => {
    const spec = { c: { Kind: { type: "string", enum: ["glasses", "phone"] }, Device: { type: "object" } } };
    expect(typeOf({ $ref: "#/c/Device" }, spec)).toBe("Device");
    expect(typeOf({ $ref: "#/c/Kind" }, spec)).toBe('"glasses" | "phone"');
    expect(typeOf({ type: ["string", "null"] })).toBe("string | null");
    expect(typeOf({ type: "string", enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(typeOf({ type: "array", items: { $ref: "#/x/Grant" } })).toBe("Grant[]");
    expect(typeOf({ type: "array", items: { $ref: "#/c/Kind" } }, spec)).toBe('("glasses" | "phone")[]');
    expect(typeOf({ type: "string", enum: ["a", "b", "c", "d", "e"] })).toBe("string");
    expect(typeOf({ oneOf: [{ $ref: "#/x/DeviceKind" }, { type: "null" }] })).toBe("DeviceKind | null");
  });
});

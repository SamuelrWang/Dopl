/**
 * INVARIANT SUITE — ontology zod schema contracts. Locks the attribute-value
 * shapes MCP `dopl_ontology` set_attribute and REST both depend on:
 * knowledge/skill accept arbitrary string arrays (slugs, ids, entry refs), ref
 * requires UUIDs. Plus array/length caps on object updates.
 */

import { describe, it, expect } from "vitest";
import {
  OntologyObjectUpdateSchema,
  OntologyCreateSchema,
  OntologyObjectCreateSchema,
} from "./schema";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function attr(value: unknown) {
  return OntologyObjectUpdateSchema.safeParse({
    attributes: [{ key: "k", label: "L", value }],
  });
}

describe("attribute value shapes", () => {
  it("knowledge accepts a string array (slugs / ids / entry refs)", () => {
    expect(attr({ kind: "knowledge", value: ["ai-ops-leads", UUID, "ai-ops-leads/Track 1 leads"] }).success).toBe(true);
  });

  it("skill accepts a string array", () => {
    expect(attr({ kind: "skill", value: ["my-skill", UUID] }).success).toBe(true);
  });

  it("ref requires UUIDs — a bare slug is rejected", () => {
    expect(attr({ kind: "ref", value: [UUID] }).success).toBe(true);
    expect(attr({ kind: "ref", value: ["not-a-uuid"] }).success).toBe(false);
  });

  it("text/pill carry a string value with caps", () => {
    expect(attr({ kind: "text", value: "hello" }).success).toBe(true);
    expect(attr({ kind: "text", value: "a".repeat(4001) }).success).toBe(false);
    expect(attr({ kind: "pill", value: "a".repeat(401) }).success).toBe(false);
  });

  it("knowledge/skill value arrays cap at 50", () => {
    expect(attr({ kind: "knowledge", value: Array(50).fill("x") }).success).toBe(true);
    expect(attr({ kind: "knowledge", value: Array(51).fill("x") }).success).toBe(false);
  });
});

describe("object/ontology caps", () => {
  it("ontology name is 1..200 and purpose ≤ 1000", () => {
    expect(OntologyCreateSchema.safeParse({ name: "AI Ops" }).success).toBe(true);
    expect(OntologyCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(OntologyCreateSchema.safeParse({ name: "x", purpose: "a".repeat(1001) }).success).toBe(false);
  });

  it("object create requires exactly one of ontologyId / parentObjectId", () => {
    expect(OntologyObjectCreateSchema.safeParse({ name: "Col", ontologyId: UUID }).success).toBe(true);
    expect(OntologyObjectCreateSchema.safeParse({ name: "Card", parentObjectId: UUID }).success).toBe(true);
    expect(OntologyObjectCreateSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(
      OntologyObjectCreateSchema.safeParse({ name: "X", ontologyId: UUID, parentObjectId: UUID }).success,
    ).toBe(false);
  });

  it("attributes array caps at 100", () => {
    const one = { key: "k", label: "L", value: { kind: "text", value: "v" } };
    expect(OntologyObjectUpdateSchema.safeParse({ attributes: Array(100).fill(one) }).success).toBe(true);
    expect(OntologyObjectUpdateSchema.safeParse({ attributes: Array(101).fill(one) }).success).toBe(false);
  });
});

/** The typed kinds and field metadata (2026-10-01) — the server is the fence. */
describe("enum / date / link and field metadata", () => {
  const withMeta = (a: Record<string, unknown>) =>
    OntologyObjectUpdateSchema.safeParse({ attributes: [{ key: "k", label: "L", ...a }] });

  it("an enum value must be one of the attribute's options (empty = unset)", () => {
    const options = ["Even Realities", "Real Kids"];
    expect(withMeta({ value: { kind: "enum", value: "Real Kids" }, options }).success).toBe(true);
    expect(withMeta({ value: { kind: "enum", value: "" }, options }).success).toBe(true);
    expect(withMeta({ value: { kind: "enum", value: "Acme" }, options }).success).toBe(false);
    expect(withMeta({ value: { kind: "enum", value: "Acme" } }).success).toBe(false);
  });

  it("options are unique (case-insensitive) and capped", () => {
    expect(withMeta({ value: { kind: "enum", value: "" }, options: ["A", "a"] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `o${i}`);
    expect(withMeta({ value: { kind: "enum", value: "" }, options: many }).success).toBe(false);
  });

  it("a date is a real YYYY-MM-DD day", () => {
    expect(attr({ kind: "date", value: "2026-10-01" }).success).toBe(true);
    expect(attr({ kind: "date", value: "" }).success).toBe(true);
    expect(attr({ kind: "date", value: "2026-02-30" }).success).toBe(false);
    expect(attr({ kind: "date", value: "10/01/2026" }).success).toBe(false);
  });

  it("a link is an absolute http(s) URL", () => {
    expect(attr({ kind: "link", value: "https://evenrealities.com" }).success).toBe(true);
    expect(attr({ kind: "link", value: "" }).success).toBe(true);
    for (const bad of ["evenrealities.com", "javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.c"]) {
      expect(attr({ kind: "link", value: bad }).success, bad).toBe(false);
    }
  });

  it("descriptions ride attributes and template fields; legacy rows still parse", () => {
    expect(withMeta({ value: { kind: "text", value: "" }, description: "why" }).success).toBe(true);
    expect(
      OntologyObjectUpdateSchema.safeParse({
        template: [
          { key: "c", label: "C", kind: "enum", options: ["A"], description: "d" },
          { key: "t", label: "T", kind: "text" },
        ],
      }).success
    ).toBe(true);
    expect(withMeta({ value: { kind: "text", value: "" }, description: "x".repeat(1001) }).success).toBe(false);
  });
});

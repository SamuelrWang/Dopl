/**
 * INVARIANT SUITE — ontology zod schema contracts.
 *
 * Locks the attribute-value shapes the MCP `dopl_ontology` set_attribute op
 * and the REST layer both depend on: knowledge/skill attributes accept
 * arbitrary string arrays (slugs, ids, or entry refs), while ref attributes
 * require UUIDs. Plus the array/length caps on object updates.
 */

import { describe, it, expect } from "vitest";
import {
  OntologyObjectUpdateSchema,
  OntologyClusterCreateSchema,
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

describe("object/cluster caps", () => {
  it("cluster name is 1..200 and purpose ≤ 1000", () => {
    expect(OntologyClusterCreateSchema.safeParse({ name: "AI Ops" }).success).toBe(true);
    expect(OntologyClusterCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(OntologyClusterCreateSchema.safeParse({ name: "x", purpose: "a".repeat(1001) }).success).toBe(false);
  });

  it("object create requires exactly one of clusterId / parentObjectId", () => {
    expect(OntologyObjectCreateSchema.safeParse({ name: "Col", clusterId: UUID }).success).toBe(true);
    expect(OntologyObjectCreateSchema.safeParse({ name: "Card", parentObjectId: UUID }).success).toBe(true);
    // Neither → rejected.
    expect(OntologyObjectCreateSchema.safeParse({ name: "X" }).success).toBe(false);
    // Both → rejected.
    expect(
      OntologyObjectCreateSchema.safeParse({ name: "X", clusterId: UUID, parentObjectId: UUID }).success,
    ).toBe(false);
  });

  it("attributes array caps at 100", () => {
    const one = { key: "k", label: "L", value: { kind: "text", value: "v" } };
    expect(OntologyObjectUpdateSchema.safeParse({ attributes: Array(100).fill(one) }).success).toBe(true);
    expect(OntologyObjectUpdateSchema.safeParse({ attributes: Array(101).fill(one) }).success).toBe(false);
  });
});

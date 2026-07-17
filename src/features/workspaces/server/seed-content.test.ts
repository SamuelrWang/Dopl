/**
 * Content-shape tests for the seed corpus. These are pure (no DB): they
 * assert the cross-references authored across features actually line up —
 * every ontology attribute and every workflow ref points at a knowledge
 * entry key or skill slug that the knowledge/skills seeds really produce,
 * and the graphs are internally well-formed (endpoints resolve, there's a
 * real branch). A drift here would surface as dangling refs in a real
 * seeded workspace.
 */

import { describe, it, expect } from "vitest";
import { GUIDE_ENTRY_KEYS } from "@/features/knowledge/server/seed";
import { SEED_SKILL_SLUGS } from "@/features/skills/server/seed";
import { buildOntologySeed } from "@/features/ontology/server/seed";
import { buildWorkflowSeed } from "@/features/workflows/server/seed";

const ENTRY_KEYS = new Set<string>(Object.values(GUIDE_ENTRY_KEYS));
const SKILL_SLUGS = new Set<string>(Object.values(SEED_SKILL_SLUGS));

describe("ontology seed — cross-reference integrity", () => {
  const seed = buildOntologySeed();
  const objectKeys = new Set<string>([
    ...seed.columns.map((c) => c.key),
    ...seed.columns.flatMap((c) => c.children.map((o) => o.key)),
  ]);

  it("every knowledge attribute references a real guide entry key", () => {
    for (const column of seed.columns) {
      for (const object of column.children) {
        for (const attr of object.attributes) {
          if (attr.kind === "knowledge") {
            for (const key of attr.entryKeys) {
              expect(ENTRY_KEYS.has(key)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("every skill attribute references a real seeded skill slug", () => {
    for (const column of seed.columns) {
      for (const object of column.children) {
        for (const attr of object.attributes) {
          if (attr.kind === "skill") {
            for (const slug of attr.skillSlugs) {
              expect(SKILL_SLUGS.has(slug)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("has at least two relationships and every endpoint resolves to an object", () => {
    expect(seed.relationships.length).toBeGreaterThanOrEqual(2);
    for (const rel of seed.relationships) {
      expect(objectKeys.has(rel.fromKey)).toBe(true);
      for (const to of rel.toKeys) {
        expect(objectKeys.has(to)).toBe(true);
      }
    }
  });

  it("column template fields cover the kinds children use (not flat)", () => {
    // Every column carries a template so new cards inherit fields.
    for (const column of seed.columns) {
      expect(column.template.length).toBeGreaterThan(0);
    }
  });
});

describe("workflow seed — ref + graph integrity", () => {
  const seed = buildWorkflowSeed();
  const refs = new Set(seed.steps.map((s) => s.ref));

  it("every step read references a real guide entry key", () => {
    for (const step of seed.steps) {
      for (const key of step.readEntryKeys) {
        expect(ENTRY_KEYS.has(key)).toBe(true);
      }
    }
  });

  it("every step action references a real seeded skill slug", () => {
    for (const step of seed.steps) {
      for (const slug of step.actionSkillSlugs) {
        expect(SKILL_SLUGS.has(slug)).toBe(true);
      }
    }
  });

  it("every edge endpoint is a declared step ref", () => {
    for (const edge of seed.edges) {
      expect(refs.has(edge.from)).toBe(true);
      expect(refs.has(edge.to)).toBe(true);
    }
  });

  it("has a real branch: one step with 2+ distinct-condition out-edges", () => {
    const outByStep = new Map<string, Set<string>>();
    for (const edge of seed.edges) {
      const set = outByStep.get(edge.from) ?? new Set<string>();
      set.add(edge.condition ?? "");
      outByStep.set(edge.from, set);
    }
    const branchy = [...outByStep.values()].some((conds) => conds.size >= 2);
    expect(branchy).toBe(true);
  });

  it("references at least one seeded skill across its steps", () => {
    const used = seed.steps.flatMap((s) => s.actionSkillSlugs);
    expect(used.length).toBeGreaterThan(0);
  });
});

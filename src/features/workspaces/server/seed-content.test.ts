/**
 * Content-shape tests for the seed corpus, pure (no DB): every ontology
 * attribute must point at a knowledge entry key or skill slug the
 * knowledge/skills seeds really produce, and every relationship endpoint must
 * resolve. Drift here = dangling refs in a real seeded workspace.
 */

import { describe, it, expect } from "vitest";
import {
  GUIDE_ENTRY_KEYS,
  buildSeedKnowledgeBases,
} from "@/features/knowledge/server/seed";
import { SEED_SKILL_SLUGS, buildSeedSkills } from "@/features/skills/server/seed";
import { buildOntologySeed } from "@/features/ontology/server/seed";
import { buildChatSeed } from "@/features/chats/server/seed";

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

/**
 * ⚠ Workflows are retired (docs/RETIREMENT-UNWIRING-PLAN.md, D5). No seeded
 * skill, guide entry, or ontology attribute may teach a surface a new
 * workspace no longer has.
 */
describe("seed corpus — workflows stay retired", () => {
  it("seeds no skill that teaches workflows", () => {
    const skills = buildSeedSkills();
    expect(skills.map((s) => s.slug)).not.toContain("walk-a-workflow");
    for (const skill of skills) {
      const text = [
        skill.name,
        skill.description,
        skill.whenToUse,
        skill.whenNotToUse,
        skill.body,
      ].join("\n");
      expect(text.toLowerCase()).not.toContain("workflow");
    }
  });

  it("seeds no guide entry that teaches workflows", () => {
    for (const base of buildSeedKnowledgeBases()) {
      for (const entry of base.rootEntries) {
        const text = [entry.title, entry.excerpt, entry.body].join("\n");
        expect(text.toLowerCase()).not.toContain("workflow");
      }
    }
  });

  it("seeds no ontology object that teaches workflows", () => {
    const seed = buildOntologySeed();
    for (const column of seed.columns) {
      for (const object of column.children) {
        const text = [
          object.name,
          object.subtitle ?? "",
          ...object.attributes.map((a) =>
            a.kind === "text" ? `${a.label} ${a.value}` : a.label
          ),
        ].join("\n");
        expect(text.toLowerCase()).not.toContain("workflow");
      }
    }
  });

  it("seeds no sample chat message that teaches workflows", () => {
    const chat = buildChatSeed();
    const text = [
      chat.title,
      chat.overview ?? "",
      ...(chat.learnings ?? []),
      ...(chat.deliverables ?? []).map((d) => d.label),
      ...chat.messages.map((m) => m.summary),
    ].join("\n");
    expect(text.toLowerCase()).not.toContain("workflow");
  });
});

/**
 * The exact starter corpus a NEW workspace receives. Pinned so an edit has to
 * be deliberate — this is what a fresh owner sees on first login and what the
 * bootstrap prompt assumes exists.
 */
describe("seed corpus — what a new workspace gets", () => {
  it("one knowledge base with five guide entries", () => {
    const bases = buildSeedKnowledgeBases();
    expect(bases.map((b) => b.slug)).toEqual(["dopl-guide"]);
    expect(bases[0].rootEntries.map((e) => e.key)).toEqual([
      "what-is-dopl",
      "the-mcp-tools",
      "the-session-ritual",
      "building-the-ontology",
      "knowledge-vs-skills",
    ]);
  });

  it("three skills", () => {
    expect(buildSeedSkills().map((s) => s.slug)).toEqual([
      "archive-a-session-to-chats",
      "file-knowledge-well",
      "author-the-ontology",
    ]);
  });

  it("one ontology cluster: two columns, seven objects", () => {
    const seed = buildOntologySeed();
    expect(seed.clusterSlug).toBe("dopl-playbook");
    expect(seed.columns.map((c) => c.key)).toEqual(["surfaces", "rituals"]);
    expect(seed.columns.flatMap((c) => c.children.map((o) => o.key))).toEqual([
      "surface-knowledge",
      "surface-skills",
      "surface-ontology",
      "surface-chats",
      "ritual-start",
      "ritual-end",
      "ritual-upkeep",
    ]);
  });

  it("one sample chat", () => {
    expect(buildChatSeed().clientSessionId).toBe("dopl-seed-getting-started");
  });
});

import "server-only";
import type { TemplateField } from "../types";
import { GUIDE_ENTRY_KEYS } from "@/features/knowledge/server/seed";
import { SEED_SKILL_SLUGS } from "@/features/skills/server/seed";

/**
 * Seed ontology for a new workspace: the "Dopl Playbook" cluster. Two columns
 * (Surfaces, Rituals) whose attributes point at the seeded Skills and Knowledge
 * entries — the cross-references are the point, a fresh workspace shows a
 * connected graph.
 *
 * Pure content — no I/O, no ids. Attributes reference seeded rows by stable
 * key/slug; `service-seed.ts` resolves them to uuids at insert time.
 */

export const DOPL_PLAYBOOK_SLUG = "dopl-playbook";

/** An attribute on a seeded object, addressed by cross-reference key. */
export type SeedAttr =
  | { label: string; kind: "text"; value: string }
  | { label: string; kind: "knowledge"; entryKeys: string[] }
  | { label: string; kind: "skill"; skillSlugs: string[] };

export interface SeedObject {
  /** Stable key within this seed — relationship endpoints reference it. */
  key: string;
  name: string;
  subtitle?: string;
  attributes: SeedAttr[];
}

export interface SeedColumn {
  key: string;
  name: string;
  subtitle?: string;
  /** Fields new cards inherit as empty attributes. */
  template: TemplateField[];
  children: SeedObject[];
}

export interface SeedRelationship {
  fromKey: string;
  label: string;
  toKeys: string[];
}

export interface OntologySeed {
  clusterName: string;
  clusterSlug: string;
  purpose: string;
  columns: SeedColumn[];
  relationships: SeedRelationship[];
}

const SURFACE_TEMPLATE: TemplateField[] = [
  { key: "purpose", label: "Purpose", kind: "text" },
  { key: "mcp-tool", label: "MCP tool", kind: "text" },
  { key: "learn-more", label: "Learn more", kind: "knowledge" },
];

const RITUAL_TEMPLATE: TemplateField[] = [
  { key: "cadence", label: "Cadence", kind: "text" },
  { key: "skill", label: "Skill", kind: "skill" },
  { key: "reference", label: "Reference", kind: "knowledge" },
];

export function buildOntologySeed(): OntologySeed {
  return {
    clusterName: "Dopl Playbook",
    clusterSlug: DOPL_PLAYBOOK_SLUG,
    purpose:
      "How this workspace is meant to be used — its surfaces and the rituals that keep them current.",
    columns: [
      {
        key: "surfaces",
        name: "Surfaces",
        subtitle: "What the workspace is made of",
        template: SURFACE_TEMPLATE,
        children: [
          {
            key: "surface-knowledge",
            name: "Knowledge",
            subtitle: "Durable reference",
            attributes: [
              { label: "Purpose", kind: "text", value: "Facts and reference humans and agents reread." },
              { label: "MCP tool", kind: "text", value: "dopl_kb" },
              { label: "Learn more", kind: "knowledge", entryKeys: [GUIDE_ENTRY_KEYS.knowledgeVsSkills] },
            ],
          },
          {
            key: "surface-skills",
            name: "Skills",
            subtitle: "Repeatable procedures",
            attributes: [
              { label: "Purpose", kind: "text", value: "One-task procedures served live to the agent." },
              { label: "MCP tool", kind: "text", value: "dopl_skill" },
              { label: "Example skill", kind: "skill", skillSlugs: [SEED_SKILL_SLUGS.fileKnowledge] },
            ],
          },
          {
            key: "surface-ontology",
            name: "Ontology",
            subtitle: "The object graph",
            attributes: [
              { label: "Purpose", kind: "text", value: "The things your work is about, and how they connect." },
              { label: "MCP tool", kind: "text", value: "dopl_ontology" },
              { label: "Example skill", kind: "skill", skillSlugs: [SEED_SKILL_SLUGS.authorOntology] },
            ],
          },
          {
            key: "surface-chats",
            name: "Chats",
            subtitle: "Session archive",
            attributes: [
              { label: "Purpose", kind: "text", value: "The record of past sessions — decisions, deliverables, learnings." },
              { label: "MCP tool", kind: "text", value: "dopl_chats" },
              { label: "Example skill", kind: "skill", skillSlugs: [SEED_SKILL_SLUGS.archiveSession] },
            ],
          },
        ],
      },
      {
        key: "rituals",
        name: "Rituals",
        subtitle: "What keeps the workspace alive",
        template: RITUAL_TEMPLATE,
        children: [
          {
            key: "ritual-start",
            name: "Session start",
            subtitle: "Orient before acting",
            attributes: [
              { label: "Cadence", kind: "text", value: "Every session" },
              { label: "Do", kind: "text", value: "Call dopl_map first, then open any matching skill or entry." },
              { label: "Reference", kind: "knowledge", entryKeys: [GUIDE_ENTRY_KEYS.sessionRitual] },
            ],
          },
          {
            key: "ritual-end",
            name: "Session end",
            subtitle: "Leave a trail",
            attributes: [
              { label: "Cadence", kind: "text", value: "Every session" },
              { label: "Skill", kind: "skill", skillSlugs: [SEED_SKILL_SLUGS.archiveSession] },
              { label: "Reference", kind: "knowledge", entryKeys: [GUIDE_ENTRY_KEYS.sessionRitual] },
            ],
          },
          {
            key: "ritual-upkeep",
            name: "Weekly upkeep",
            subtitle: "Keep the graph honest",
            attributes: [
              { label: "Cadence", kind: "text", value: "Weekly" },
              { label: "Skill", kind: "skill", skillSlugs: [SEED_SKILL_SLUGS.authorOntology] },
              { label: "Reference", kind: "knowledge", entryKeys: [GUIDE_ENTRY_KEYS.buildingOntology] },
            ],
          },
        ],
      },
    ],
    relationships: [
      { fromKey: "ritual-start", label: "reads", toKeys: ["surface-knowledge"] },
      { fromKey: "ritual-end", label: "archives to", toKeys: ["surface-chats"] },
      { fromKey: "ritual-upkeep", label: "maintains", toKeys: ["surface-ontology", "surface-skills"] },
    ],
  };
}

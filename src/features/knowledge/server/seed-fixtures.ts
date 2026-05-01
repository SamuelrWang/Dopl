import "server-only";
import { HARDCODED_KBS } from "./seed-fixtures-data";
import type { KnowledgeEntryType } from "../types";

/**
 * Server-side adapter that reshapes the canonical fixture data in
 * `./seed-fixtures-data.ts` into the domain-typed seed inputs the
 * service consumes when bootstrapping a new workspace.
 *
 * Structure: each fixture is a flat KB (no folders). Entries land at
 * the base root (`folder_id IS NULL`). The shape supports nested
 * folders for future use; legacy fixtures just don't populate them.
 */

export interface SeedEntryInput {
  title: string;
  excerpt: string;
  body: string;
  entryType: KnowledgeEntryType;
  position?: number;
}

export interface SeedFolderInput {
  name: string;
  position?: number;
  folders?: SeedFolderInput[];
  entries?: SeedEntryInput[];
}

export interface SeedFixture {
  name: string;
  slug: string;
  description: string;
  agentWriteEnabled?: boolean;
  rootFolders: SeedFolderInput[];
  rootEntries: SeedEntryInput[];
}

export const SEED_FIXTURES: SeedFixture[] = HARDCODED_KBS.map((kb) => ({
  name: kb.name,
  slug: kb.slug,
  description: kb.description,
  agentWriteEnabled: false,
  rootFolders: [],
  rootEntries: kb.entries.map((entry, entryIndex) => ({
    title: entry.title,
    excerpt: entry.excerpt,
    body: entry.body,
    entryType: entry.type as KnowledgeEntryType,
    position: entryIndex,
  })),
}));

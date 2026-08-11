import "server-only";
import type { KnowledgeEntryType } from "../types";

/**
 * Seed-input shapes for workspace bootstrap. The canonical content lives
 * in `./seed.ts` (`buildSeedKnowledgeBases`); `service-seed.ts` iterates
 * these to insert a base + its root entries when a new workspace is
 * created.
 *
 * Each fixture is a flat KB (no folders). Entries land at the base root
 * (`folder_id IS NULL`). The shape supports nested folders for future
 * use; the current Dopl Guide fixture is flat.
 */

export interface SeedEntryInput {
  /**
   * Stable cross-reference handle (NOT the DB id). The seed orchestrator
   * maps this key → the inserted entry's uuid so ontology objects and
   * other seeds can point at specific entries by a name that's known
   * at authoring time.
   */
  key?: string;
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

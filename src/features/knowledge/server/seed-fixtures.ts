import "server-only";
import type { KnowledgeEntryType } from "../types";

/**
 * Seed-input shapes for workspace bootstrap. Content lives in `./seed.ts`
 * (`buildSeedKnowledgeBases`); `service-seed.ts` iterates these.
 *
 * Fixtures are flat — entries land at the base root (`folder_id IS NULL`).
 * The shape supports nested folders; nothing uses them yet.
 */

export interface SeedEntryInput {
  /** ⚠ Stable cross-reference handle, NOT the DB id. The orchestrator maps
   *  key → inserted uuid so other seeds can point at entries by an
   *  authoring-time name. */
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

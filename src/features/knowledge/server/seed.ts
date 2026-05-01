import "server-only";
import { SEED_FIXTURES, type SeedFixture } from "./seed-fixtures";

/**
 * Returns the canonical seed knowledge bases as create-shaped inputs.
 *
 * Pure function — no I/O. The actual workspace seeding (DB inserts)
 * lives in `service.ts#seedWorkspace`, which iterates this list.
 *
 * Two callers:
 *   1. `service.listBases` — lazy seeding for new workspaces.
 *   2. `scripts/seed-knowledge-bases.ts` — explicit `--all` backfill.
 */
export function buildSeedKnowledgeBases(): SeedFixture[] {
  return SEED_FIXTURES;
}

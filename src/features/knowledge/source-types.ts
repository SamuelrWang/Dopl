/**
 * Re-export shim — audit cohesion fix F-3 folded the actual `SourceProvider`
 * and `SourceConnection` declarations into `./types.ts` to match the
 * ENGINEERING.md §3 layout (one types file per feature). Existing import
 * sites (mostly under `src/features/skills/`) keep working through this
 * shim until they migrate to the new path; delete this file once nothing
 * imports `@/features/knowledge/source-types` anymore.
 */
export type { SourceProvider, SourceConnection } from "./types";

/**
 * Ingestion pipeline — public surface.
 *
 * Historical context: this file used to be the 1200-line monolith that
 * ran the entire server-side Claude pipeline. After the pivot to
 * agent-driven ingest (prepare_ingest + submit_ingested_entry), the
 * orchestration shrunk to a handful of step helpers plus three
 * agent-facing entrypoints. P3a of the refactor split those into
 * topic-focused sub-modules under `./pipeline/`:
 *
 *   strategy.ts      — per-content-type pipeline knobs
 *   util.ts          — deleteFailedEntry, detectPlatform, logStep
 *   storage.ts       — storeSources, generateEntrySlug
 *   platform-fetch.ts — stepPlatformFetch (tweet/IG/reddit/GH/web)
 *   links.ts         — text-extract, link-follow, gather-content, recurse
 *   agent.ts         — extractForAgent, persistAgentArtifacts, finalizeAgentEntry
 *
 * This file is the public barrel. Importers keep using
 * `@/lib/ingestion/pipeline` unchanged; switch to the sub-module paths
 * only for new code or when touching an importer for other reasons.
 *
 * Legacy exports that have been removed (and should not come back unless
 * server-side synthesis returns): ingestEntry, runPipeline,
 * stepClassifyContent, stepGenerateManifest, stepGenerateReadme,
 * stepGenerateSecondaryArtifact, stepGenerateTags, stepPersistEntry,
 * stepChunkAndEmbed.
 */

export { deleteFailedEntry, detectPlatform, logStep } from "./pipeline/util";
export { storeSources } from "./pipeline/storage";
export { stepPlatformFetch } from "./pipeline/platform-fetch";
export {
  stepTextExtraction,
  stepLinkFollowing,
  stepGatherContent,
} from "./pipeline/links";
export {
  extractForAgent,
  persistAgentArtifacts,
  finalizeAgentEntry,
} from "./pipeline/agent";

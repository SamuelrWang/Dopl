import type { ContentType } from "../types";
import type { ModelTier } from "@/shared/lib/ai";
import { MAX_LINK_DEPTH } from "@/config";

/**
 * Per-content-type pipeline knobs. `PIPELINE_STRATEGIES` maps each
 * `ContentType` to the link-depth, model-tier, and feature flags the
 * orchestrator should use when processing that content.
 *
 * Many of the `models.*` fields point at legacy Claude-generation stages
 * that no longer run server-side (classifier, manifest, readme, etc.);
 * they're retained so any future path that wants to re-enable a stage
 * can consult the table rather than inventing fresh defaults.
 */
export interface PipelineStrategy {
  classifyContent: boolean;
  linkDepth: number;
  maxLinks: number;
  generateSecondaryArtifact: boolean;
  models: {
    classifier: ModelTier;
    contentClassifier: ModelTier;
    manifest: ModelTier;
    readme: ModelTier;
    secondary: ModelTier;
    tags: ModelTier;
  };
}

export const PIPELINE_STRATEGIES: Record<ContentType, PipelineStrategy> = {
  setup: {
    classifyContent: true, linkDepth: MAX_LINK_DEPTH, maxLinks: 30, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "sonnet", manifest: "sonnet", readme: "sonnet", secondary: "sonnet", tags: "haiku" },
  },
  tutorial: {
    classifyContent: true, linkDepth: MAX_LINK_DEPTH, maxLinks: 30, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "sonnet", manifest: "sonnet", readme: "sonnet", secondary: "sonnet", tags: "haiku" },
  },
  knowledge: {
    classifyContent: false, linkDepth: 1, maxLinks: 10, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
  article: {
    classifyContent: false, linkDepth: 1, maxLinks: 10, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
  resource: {
    classifyContent: false, linkDepth: MAX_LINK_DEPTH, maxLinks: 30, generateSecondaryArtifact: false,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
  reference: {
    classifyContent: false, linkDepth: 2, maxLinks: 15, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
};

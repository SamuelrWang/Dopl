import { z } from "zod";

// Ingest request
export const IngestRequestSchema = z.object({
  url: z.string().url(),
  content: z.object({
    text: z.string().optional().default(""), // optional when URL is a tweet (auto-fetched)
    images: z.array(z.string()).optional(), // base64 encoded images
    links: z.array(z.string().url()).optional(),
  }),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

// Agent-driven ingest: submit finished artifacts after the agent ran the
// prompts returned by /api/ingest/prepare. Mirrors the shapes written by
// stepPersistEntry in src/lib/ingestion/pipeline.ts.
export const IngestSubmitSchema = z.object({
  entry_id: z.string().uuid(),
  content_type: z.enum([
    "setup",
    "tutorial",
    "knowledge",
    "article",
    "reference",
    "resource",
  ]),
  source_type: z.string().default("other"),
  // The manifest shape is validated defensively — required fields are checked
  // here so persist doesn't write an entry missing a title. Additional
  // fields (tools, integrations, languages, etc.) pass through via
  // `.passthrough()`.
  manifest: z
    .object({
      title: z.string().min(1),
      description: z.string().default(""),
      use_case: z
        .object({
          primary: z.string(),
          secondary: z.array(z.string()).optional(),
        })
        .passthrough(),
      complexity: z.enum(["simple", "moderate", "complex", "advanced"]),
    })
    .passthrough(),
  readme: z.string().min(1),
  // Empty string allowed (content_type="resource" has no secondary artifact).
  agents_md: z.string().default(""),
  tags: z
    .array(
      z.object({
        tag_type: z.string().min(1),
        tag_value: z.string().min(1),
      })
    )
    .default([]),
  // Optional — only setup/tutorial content types use the section classifier.
  content_classification: z
    .object({
      sections: z
        .array(
          z
            .object({
              title: z.string(),
              classification: z.enum([
                "EXECUTABLE",
                "TACTICAL",
                "CONTEXT",
                "SKIP",
              ]),
              reason: z.string(),
              content_preview: z.string(),
            })
            .passthrough()
        )
        .optional(),
      stats: z.record(z.string(), z.unknown()).optional(),
      preservation_notes: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  // Optional — one entry per image the agent ran vision on. Persisted into
  // the `sources` table so downstream search/render treats them identically
  // to legacy-path images.
  image_analyses: z
    .array(
      z.object({
        image_id: z.string().optional(),
        source_type: z.enum([
          "code_screenshot",
          "architecture_diagram",
          "image",
          "other",
        ]),
        raw_content: z.string(),
        extracted_content: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional(),
});
export type IngestSubmit = z.infer<typeof IngestSubmitSchema>;

// Query request. `include_synthesis` has been removed — agents format
// recommendations in their own model context now. Extra keys are
// ignored by Zod's default stripping so old clients that still send
// the flag won't break; they just won't get a `synthesis` field back.
export const QueryRequestSchema = z.object({
  query: z.string().min(1),
  filters: z
    .object({
      tags: z.array(z.string()).optional(),
      use_case: z.string().optional(),
      complexity: z.string().optional(),
      tools: z.array(z.string()).optional(),
    })
    .optional(),
  max_results: z.number().int().min(1).max(50).optional().default(10),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

// Build request
export const BuildRequestSchema = z.object({
  brief: z.string().min(1),
  constraints: z
    .object({
      preferred_tools: z.array(z.string()).optional(),
      excluded_tools: z.array(z.string()).optional(),
      max_complexity: z.string().optional(),
      budget_context: z.string().optional(),
    })
    .optional(),
});
export type BuildRequest = z.infer<typeof BuildRequestSchema>;

// Entry update
export const EntryUpdateSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  use_case: z.string().optional(),
  complexity: z.enum(["simple", "moderate", "complex", "advanced"]).optional(),
});
export type EntryUpdate = z.infer<typeof EntryUpdateSchema>;

// Query response types. `synthesis` and per-entry `relevance_explanation`
// were removed when server-side synthesis was retired; agents format
// both in their own context now.
export interface QueryResponse {
  entries: {
    entry_id: string;
    slug: string | null;
    title: string | null;
    summary: string | null;
    similarity: number;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    source_platform: string | null;
    created_at: string | null;
    descriptor?: string | null;
    ingestion_tier?: "skeleton" | "full" | null;
  }[];
}

/**
 * Response shape of POST /api/build after the client-only-synthesis pivot.
 * The server runs retrieval and returns the pre-filled synthesis prompt —
 * the agent runs the prompt in its own context and produces the composite.
 * Nothing is persisted.
 */
export interface BuildBundle {
  status: "ready" | "no_matches";
  brief: string;
  constraints:
    | {
        preferred_tools?: string[];
        excluded_tools?: string[];
        max_complexity?: string;
        budget_context?: string;
      }
    | null;
  entries: Array<{
    entry_id: string;
    slug: string | null;
    title: string | null;
    similarity: number;
  }>;
  /** The fully-substituted builder prompt. Run this in your own Claude context. */
  prompt: string;
  /** Step-by-step usage notes for the agent. */
  instructions: string;
}

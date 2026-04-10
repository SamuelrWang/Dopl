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

// Query request
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
  include_synthesis: z.boolean().optional().default(true),
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

// Query response types
export interface QueryResponse {
  entries: {
    entry_id: string;
    title: string | null;
    summary: string | null;
    similarity: number;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    relevance_explanation?: string;
  }[];
  synthesis?: {
    recommendation: string;
    composite_approach?: string;
  };
}

export interface BuildResponse {
  composite_readme: string;
  composite_agents_md: string;
  source_entries: {
    entry_id: string;
    title: string;
    how_used: string;
  }[];
  confidence: {
    score: number;
    gaps: string[];
    suggestions: string[];
  };
}

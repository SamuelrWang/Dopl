/**
 * POST /api/query — semantic search over the Dopl knowledge base.
 *
 * After the client-only-synthesis pivot this route only does retrieval.
 * The legacy `include_synthesis` branch ran a server-side Claude call
 * (`synthesizeResults`) to produce a recommendation + per-entry relevance
 * explanations; that's the agent's job now. Consumers that used to rely
 * on `response.synthesis` should either (a) format recommendations
 * themselves in the caller's own model context, or (b) skip the field
 * entirely — the raw entries are still returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { QueryRequestSchema } from "@/types/api";
import { searchEntries } from "@/lib/retrieval/search";
import { withMcpCredits } from "@/shared/auth/with-auth";
import { CONTENT_PREVIEW_LENGTH } from "@/config";
import type { SubscriptionTier } from "@/lib/billing/subscriptions";

async function handlePost(
  request: NextRequest,
  { userId, tier }: { userId: string; tier: SubscriptionTier }
) {
  try {
    const body = await request.json();
    const parsed = QueryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { query, filters, max_results } = parsed.data;

    // Vector search. No LLM call here — retrieval only.
    // callerUserId gates non-approved entries out of the results — without
    // it, pending/rejected entries would leak to every MCP search_setups.
    const results = await searchEntries(query, {
      tags: filters?.tags,
      useCase: filters?.use_case,
      complexity: filters?.complexity,
      maxResults: max_results,
      callerUserId: userId,
    });

    // Format response — gate content depth for free users.
    const entries = results.map((r) => ({
      entry_id: r.entry_id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      similarity: r.similarity,
      readme:
        tier === "free" && r.readme
          ? r.readme.slice(0, CONTENT_PREVIEW_LENGTH) +
            "\n\n---\n*Upgrade to Pro to see the full implementation details.*"
          : r.readme,
      agents_md: tier === "free" ? null : r.agents_md,
      manifest: r.manifest,
      source_platform: r.source_platform,
      created_at: r.created_at,
      descriptor: r.descriptor,
      ingestion_tier: r.ingestion_tier,
    }));

    // No synthesis — clients format recommendations in their own context.
    // Tier is deliberately NOT returned (leaking it lets attackers
    // enumerate plans); kept as a ref so the lint doesn't trip on the
    // destructured-but-unused parameter.
    void tier;
    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Query failed", message },
      { status: 500 }
    );
  }
}

export const POST = withMcpCredits("mcp_search", handlePost);

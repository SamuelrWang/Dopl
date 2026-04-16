import { NextRequest, NextResponse } from "next/server";
import { QueryRequestSchema } from "@/types/api";
import { searchEntries } from "@/lib/retrieval/search";
import { synthesizeResults } from "@/lib/retrieval/synthesize";
import { withMcpCredits } from "@/lib/auth/with-auth";
import { CONTENT_PREVIEW_LENGTH } from "@/lib/config";
import type { SubscriptionTier } from "@/lib/billing/subscriptions";

async function handlePost(
  request: NextRequest,
  { tier }: { userId: string; tier: SubscriptionTier }
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

    const { query, filters, max_results, include_synthesis } = parsed.data;

    // Vector search
    const results = await searchEntries(query, {
      tags: filters?.tags,
      useCase: filters?.use_case,
      complexity: filters?.complexity,
      maxResults: max_results,
    });

    // Format response — gate content depth for free users
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
    }));

    // Optional LLM synthesis — pro only
    let synthesis;
    if (include_synthesis && results.length > 0) {
      if (tier === "free") {
        synthesis = {
          _locked: true,
          message:
            "AI synthesis is a Pro feature. Upgrade to get personalized recommendations.",
        };
      } else {
        const synthesisResult = await synthesizeResults(query, results);
        synthesis = {
          recommendation: synthesisResult.recommendation,
          composite_approach: synthesisResult.composite_approach,
        };

        for (const synthEntry of synthesisResult.entries) {
          const entry = entries.find((e) => e.entry_id === synthEntry.entry_id);
          if (entry) {
            (entry as Record<string, unknown>).relevance_explanation =
              synthEntry.explanation;
          }
        }
      }
    }

    // Note: subscription tier is deliberately NOT returned — clients should
    // never need to know the caller's tier, and leaking it lets an attacker
    // enumerate user plans.
    return NextResponse.json({ entries, synthesis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Query failed", message },
      { status: 500 }
    );
  }
}

export const POST = withMcpCredits("mcp_search", handlePost);

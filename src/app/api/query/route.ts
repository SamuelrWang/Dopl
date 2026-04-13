import { NextRequest, NextResponse } from "next/server";
import { QueryRequestSchema } from "@/types/api";
import { searchEntries } from "@/lib/retrieval/search";
import { synthesizeResults } from "@/lib/retrieval/synthesize";
import { withExternalAuth } from "@/lib/auth/with-auth";

async function handlePost(request: NextRequest) {
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

    // Format response
    const entries = results.map((r) => ({
      entry_id: r.entry_id,
      title: r.title,
      summary: r.summary,
      similarity: r.similarity,
      readme: r.readme,
      agents_md: r.agents_md,
      manifest: r.manifest,
      source_platform: r.source_platform,
      created_at: r.created_at,
    }));

    // Optional LLM synthesis
    let synthesis;
    if (include_synthesis && results.length > 0) {
      const synthesisResult = await synthesizeResults(query, results);
      synthesis = {
        recommendation: synthesisResult.recommendation,
        composite_approach: synthesisResult.composite_approach,
      };

      // Enrich entries with relevance explanations
      for (const synthEntry of synthesisResult.entries) {
        const entry = entries.find((e) => e.entry_id === synthEntry.entry_id);
        if (entry) {
          (entry as Record<string, unknown>).relevance_explanation =
            synthEntry.explanation;
        }
      }
    }

    return NextResponse.json({ entries, synthesis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Query failed", message },
      { status: 500 }
    );
  }
}

export const POST = withExternalAuth(handlePost);

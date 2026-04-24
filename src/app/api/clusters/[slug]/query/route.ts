import { NextRequest, NextResponse } from "next/server";
import { withMcpCredits } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { searchEntries } from "@/lib/retrieval/search";

async function handlePost(
  request: NextRequest,
  context: { userId: string; params?: Record<string, string> }
) {
  try {
    const slug = context.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const body = await request.json();
    const { query, max_results } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();

    // Resolve slug → cluster → entry IDs, scoped to the authenticated user.
    // Any cross-user lookup returns 404 (not 403) so we don't leak existence.
    const { data: cluster, error: clusterError } = await db
      .from("clusters")
      .select("id")
      .eq("slug", slug)
      .eq("user_id", context.userId)
      .single();

    if (clusterError || !cluster) {
      return NextResponse.json(
        { error: `Cluster not found: ${slug}` },
        { status: 404 }
      );
    }

    const { data: panels, error: panelError } = await db
      .from("cluster_panels")
      .select("entry_id")
      .eq("cluster_id", cluster.id);

    if (panelError) throw panelError;

    const entryIds = (panels || []).map((p) => p.entry_id);

    if (entryIds.length === 0) {
      return NextResponse.json({
        cluster_slug: slug,
        results: [],
      });
    }

    const results = await searchEntries(query, {
      entryIds,
      maxResults: max_results || 5,
    });

    return NextResponse.json({
      cluster_slug: slug,
      results: results.map((r) => ({
        entry_id: r.entry_id,
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        similarity: r.similarity,
        readme: r.readme,
        agents_md: r.agents_md,
        manifest: r.manifest,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withMcpCredits("mcp_cluster_query", handlePost);

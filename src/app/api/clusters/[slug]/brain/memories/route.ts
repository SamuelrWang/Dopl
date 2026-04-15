/**
 * POST   /api/clusters/[slug]/brain/memories — add a memory to the cluster brain
 * DELETE /api/clusters/[slug]/brain/memories — remove a memory by id
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withExternalAuth } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

// ── Helpers ─────────────────────────────────────────────────────────

async function getClusterBySlug(slug: string) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    return null;
  }
  return data;
}

/**
 * Get or create the cluster brain row. Returns the brain id.
 * Uses upsert to avoid race conditions on concurrent requests.
 */
async function getOrCreateBrain(clusterId: string): Promise<string> {
  const db = supabaseAdmin();

  const { data: brain, error } = await db
    .from("cluster_brains")
    .upsert(
      { cluster_id: clusterId, instructions: "" },
      { onConflict: "cluster_id", ignoreDuplicates: true }
    )
    .select("id")
    .single();

  if (error || !brain) {
    throw error || new Error("Failed to get or create cluster brain");
  }

  return brain.id;
}

// ── POST ────────────────────────────────────────────────────────────

async function handlePost(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const cluster = await getClusterBySlug(slug);
    if (!cluster) {
      return NextResponse.json(
        { error: `Cluster not found: ${slug}` },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "content (string) is required" },
        { status: 400 }
      );
    }

    const brainId = await getOrCreateBrain(cluster.id);

    const db = supabaseAdmin();
    const { data: memory, error } = await db
      .from("cluster_brain_memories")
      .insert({ cluster_brain_id: brainId, content })
      .select("id, content, created_at")
      .single();

    if (error || !memory) {
      throw error || new Error("Failed to create memory");
    }

    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    console.error("[memories POST] Error saving cluster memory:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE ───────────────────────────────────────────────────────────

async function handleDelete(request: NextRequest) {
  try {
    const body = await request.json();
    const { memory_id } = body;

    if (!memory_id || typeof memory_id !== "string") {
      return NextResponse.json(
        { error: "memory_id (string) is required" },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();
    const { error } = await db
      .from("cluster_brain_memories")
      .delete()
      .eq("id", memory_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withExternalAuth(handlePost);
export const DELETE = withExternalAuth(handleDelete);

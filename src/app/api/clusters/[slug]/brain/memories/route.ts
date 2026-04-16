/**
 * POST   /api/clusters/[slug]/brain/memories — add a memory to the cluster brain
 * PATCH  /api/clusters/[slug]/brain/memories — update a memory's content by id
 * DELETE /api/clusters/[slug]/brain/memories — remove a memory by id
 *
 * All operations require the authenticated user to own the target cluster.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withUserAuth } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

// ── Helpers ─────────────────────────────────────────────────────────

// Scoped cluster lookup: returns null if the user doesn't own it.
async function getClusterBySlugForUser(slug: string, userId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name")
    .eq("slug", slug)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data;
}

// Verify a memory belongs to a cluster owned by the given user.
async function memoryBelongsToUser(
  memoryId: string,
  userId: string
): Promise<boolean> {
  const db = supabaseAdmin();
  // Join: memory → brain → cluster; filter by cluster.user_id.
  const { data, error } = await db
    .from("cluster_brain_memories")
    .select("id, cluster_brains!inner(cluster_id, clusters!inner(user_id))")
    .eq("id", memoryId)
    .single();
  if (error || !data) return false;
  // Supabase typings aren't precise for nested inner joins; cast defensively.
  const brains = (data as unknown as {
    cluster_brains?: { clusters?: { user_id?: string } };
  }).cluster_brains;
  return brains?.clusters?.user_id === userId;
}

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
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getClusterBySlugForUser(slug, userId);
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

// ── PATCH ────────────────────────────────────────────────────────────

async function handlePatch(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const { memory_id, content } = body;

    if (!memory_id || typeof memory_id !== "string") {
      return NextResponse.json(
        { error: "memory_id (string) is required" },
        { status: 400 }
      );
    }
    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "content (string) is required" },
        { status: 400 }
      );
    }

    if (!(await memoryBelongsToUser(memory_id, userId))) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    const db = supabaseAdmin();
    const { data: updated, error } = await db
      .from("cluster_brain_memories")
      .update({ content })
      .eq("id", memory_id)
      .select("id, content")
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message || "Memory not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE ───────────────────────────────────────────────────────────

async function handleDelete(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const { memory_id } = body;

    if (!memory_id || typeof memory_id !== "string") {
      return NextResponse.json(
        { error: "memory_id (string) is required" },
        { status: 400 }
      );
    }

    if (!(await memoryBelongsToUser(memory_id, userId))) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
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

export const POST = withUserAuth(handlePost);
export const PATCH = withUserAuth(handlePatch);
export const DELETE = withUserAuth(handleDelete);

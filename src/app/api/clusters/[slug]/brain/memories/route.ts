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

async function getOrCreateBrain(clusterId: string, userId: string): Promise<string> {
  const db = supabaseAdmin();

  const { data: brain, error } = await db
    .from("cluster_brains")
    .upsert(
      { cluster_id: clusterId, user_id: userId, instructions: "" },
      { onConflict: "cluster_id", ignoreDuplicates: true }
    )
    .select("id")
    .single();

  if (error || !brain) {
    throw error || new Error("Failed to get or create cluster brain");
  }

  return brain.id;
}

// Re-read the full memory list for a cluster and mirror it into the
// canvas_panels brain panel's panel_data.memories array. The canvas UI
// hydrates memories from panel_data, not from cluster_brain_memories,
// so without this write-through the visible list never updates even
// though the DB is correct. Kept as an array of plain content strings
// because that's the shape the panel renderer expects today.
async function syncMemoriesToPanel(clusterId: string, userId: string) {
  const db = supabaseAdmin();
  const { data: memories } = await db
    .from("cluster_brain_memories")
    .select("content, created_at")
    .eq("cluster_id", clusterId)
    .order("created_at", { ascending: true });

  const contents = (memories ?? []).map((m) => m.content as string);

  const brainPanelId = `brain-${clusterId}`;
  const { data: panel } = await db
    .from("canvas_panels")
    .select("panel_data")
    .eq("user_id", userId)
    .eq("panel_id", brainPanelId)
    .eq("panel_type", "cluster-brain")
    .maybeSingle();

  if (!panel) return; // Headless cluster — no panel to sync.

  const currentData = (panel.panel_data as Record<string, unknown>) ?? {};
  await db
    .from("canvas_panels")
    .update({
      panel_data: { ...currentData, memories: contents },
    })
    .eq("user_id", userId)
    .eq("panel_id", brainPanelId);
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

    const brainId = await getOrCreateBrain(cluster.id, userId);

    const db = supabaseAdmin();
    const { data: memory, error } = await db
      .from("cluster_brain_memories")
      .insert({
        cluster_brain_id: brainId,
        cluster_id: cluster.id,
        user_id: userId,
        content,
      })
      .select("id, content, created_at")
      .single();

    if (error || !memory) {
      throw error || new Error("Failed to create memory");
    }

    // Mirror to canvas_panels so the UI shows the new memory without
    // a reload. Non-fatal — the memory itself is saved.
    try {
      await syncMemoriesToPanel(cluster.id, userId);
    } catch (err) {
      console.error("[memories POST] panel sync failed:", err);
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
      .select("id, content, cluster_id")
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message || "Memory not found" },
        { status: 404 }
      );
    }

    // Re-sync the panel's memory list so the edited content is
    // visible on canvas without a reload.
    const clusterId = (updated as unknown as { cluster_id: string })
      .cluster_id;
    if (clusterId) {
      try {
        await syncMemoriesToPanel(clusterId, userId);
      } catch (err) {
        console.error("[memories PATCH] panel sync failed:", err);
      }
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
    // Pull cluster_id before delete so we can resync the panel.
    const { data: toDelete } = await db
      .from("cluster_brain_memories")
      .select("cluster_id")
      .eq("id", memory_id)
      .maybeSingle();

    const { error } = await db
      .from("cluster_brain_memories")
      .delete()
      .eq("id", memory_id);

    if (error) throw error;

    const clusterId = (toDelete as { cluster_id?: string } | null)?.cluster_id;
    if (clusterId) {
      try {
        await syncMemoriesToPanel(clusterId, userId);
      } catch (err) {
        console.error("[memories DELETE] panel sync failed:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withUserAuth(handlePost);
export const PATCH = withUserAuth(handlePatch);
export const DELETE = withUserAuth(handleDelete);

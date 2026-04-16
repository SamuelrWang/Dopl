/**
 * GET  /api/clusters/[slug]/brain — fetch the cluster brain (instructions + memories)
 * PATCH /api/clusters/[slug]/brain — update the brain instructions
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withUserAuth } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

// ── Helpers ─────────────────────────────────────────────────────────

// Look up a cluster by slug, scoped to the owning user. Returns null
// if the cluster doesn't exist OR the user doesn't own it — either way
// the caller returns 404 so we don't leak existence across users.
async function getClusterBySlugForUser(slug: string, userId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name")
    .eq("slug", slug)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return null;
  }
  return data;
}

// ── GET ─────────────────────────────────────────────────────────────

async function handleGet(
  _request: NextRequest,
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

    const db = supabaseAdmin();

    // Look up the brain
    const { data: brain, error: brainError } = await db
      .from("cluster_brains")
      .select("id, instructions, created_at, updated_at")
      .eq("cluster_id", cluster.id)
      .single();

    if (brainError || !brain) {
      return NextResponse.json({ instructions: "", memories: [] });
    }

    // Fetch memories
    const { data: memories, error: memError } = await db
      .from("cluster_brain_memories")
      .select("id, content, created_at")
      .eq("cluster_brain_id", brain.id)
      .order("created_at", { ascending: true });

    if (memError) throw memError;

    return NextResponse.json({
      instructions: brain.instructions,
      memories: (memories || []).map((m) => ({ id: m.id, content: m.content })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── PATCH ───────────────────────────────────────────────────────────

async function handlePatch(
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
    const { instructions } = body;

    if (typeof instructions !== "string") {
      return NextResponse.json(
        { error: "instructions (string) is required" },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();
    const now = new Date().toISOString();

    // Upsert: insert if not exists, update if exists
    const { data: existing } = await db
      .from("cluster_brains")
      .select("id")
      .eq("cluster_id", cluster.id)
      .single();

    let brain;

    if (existing) {
      const { data, error } = await db
        .from("cluster_brains")
        .update({ instructions, updated_at: now })
        .eq("id", existing.id)
        .select("id, cluster_id, instructions, created_at, updated_at")
        .single();

      if (error) throw error;
      brain = data;
    } else {
      const { data, error } = await db
        .from("cluster_brains")
        .insert({
          cluster_id: cluster.id,
          instructions,
          updated_at: now,
        })
        .select("id, cluster_id, instructions, created_at, updated_at")
        .single();

      if (error) throw error;
      brain = data;
    }

    return NextResponse.json(brain);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withUserAuth(handleGet);
export const PATCH = withUserAuth(handlePatch);

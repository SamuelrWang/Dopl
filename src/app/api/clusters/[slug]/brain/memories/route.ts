/**
 * POST   /api/clusters/[slug]/brain/memories — add a memory to the cluster brain
 * PATCH  /api/clusters/[slug]/brain/memories — update a memory's content by id
 * DELETE /api/clusters/[slug]/brain/memories — remove a memory by id
 *
 * All operations require the caller to be an active member (≥ editor)
 * of the canvas that owns the target cluster.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import type { Role } from "@/features/workspaces/types";

export const dynamic = "force-dynamic";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  params?: Record<string, string>;
}

const MemoryCreateSchema = z.object({
  content: z.string().min(1, "content is required").max(4000),
  scope: z.enum(["workspace", "personal"]).optional(),
});

const MemoryUpdateSchema = z
  .object({
    memory_id: z.string().uuid(),
    content: z.string().min(1).max(4000).optional(),
    scope: z.enum(["workspace", "personal"]).optional(),
  })
  .refine((d) => d.content !== undefined || d.scope !== undefined, {
    message: "Provide content and/or scope",
  });

const MemoryDeleteSchema = z.object({
  memory_id: z.string().uuid(),
});

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

async function getClusterBySlugForCanvas(slug: string, workspaceId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name")
    .eq("slug", slug)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !data) return null;
  return data;
}

// Verify a memory belongs to the active canvas. Joins memory → brain →
// cluster and matches `clusters.workspace_id`. Returns the cluster_id so
// callers can re-sync the brain panel without a second lookup.
async function memoryClusterIdForCanvas(
  memoryId: string,
  workspaceId: string
): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("cluster_brain_memories")
    .select("cluster_id, cluster_brains!inner(clusters!inner(workspace_id))")
    .eq("id", memoryId)
    .single();
  if (error || !data) return null;
  const brains = (
    data as unknown as {
      cluster_id: string;
      cluster_brains?: { clusters?: { workspace_id?: string } };
    }
  );
  if (brains.cluster_brains?.clusters?.workspace_id !== workspaceId) return null;
  return brains.cluster_id;
}

async function getOrCreateBrain(
  clusterId: string,
  userId: string,
  workspaceId: string
): Promise<string> {
  const db = supabaseAdmin();
  // Upsert with ignoreDuplicates returns ZERO rows when a brain already
  // exists, so .single() errors. Use maybeSingle() and fall back to a
  // direct SELECT for the existing-brain path.
  const { data: upserted } = await db
    .from("cluster_brains")
    .upsert(
      {
        cluster_id: clusterId,
        user_id: userId,
        workspace_id: workspaceId,
        instructions: "",
      },
      { onConflict: "cluster_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (upserted?.id) return upserted.id;

  const { data: existing, error: selectError } = await db
    .from("cluster_brains")
    .select("id")
    .eq("cluster_id", clusterId)
    .single();
  if (selectError || !existing) {
    throw selectError || new Error("Failed to get or create cluster brain");
  }
  return existing.id;
}

// Re-read the workspace-scoped memory list and mirror it into the
// brain panel's `panel_data.memories` array. The canvas UI hydrates
// memories from panel_data, not directly from cluster_brain_memories,
// so without this write-through the visible list never updates.
//
// Personal memories are deliberately NOT written to panel_data — that
// JSON is shared across every viewer of the canvas, so any personal
// content there would leak. Personal memories are surfaced through the
// brain GET endpoint instead, which applies the per-user visibility
// filter.
async function syncMemoriesToPanel(clusterId: string, workspaceId: string) {
  const db = supabaseAdmin();
  const { data: memories } = await db
    .from("cluster_brain_memories")
    .select("id, content, scope, author_id, created_at")
    .eq("cluster_id", clusterId)
    .eq("scope", "workspace")
    .order("created_at", { ascending: true });

  const rows = (memories ?? []).map((m) => ({
    id: m.id as string,
    content: m.content as string,
    scope: "workspace" as const,
    author_id: m.author_id as string,
  }));

  const brainPanelId = `brain-${clusterId}`;
  const { data: panel } = await db
    .from("canvas_panels")
    .select("panel_data")
    .eq("workspace_id", workspaceId)
    .eq("panel_id", brainPanelId)
    .eq("panel_type", "cluster-brain")
    .maybeSingle();

  if (!panel) return; // Headless cluster — no panel to sync.

  const currentData = (panel.panel_data as Record<string, unknown>) ?? {};
  await db
    .from("canvas_panels")
    .update({ panel_data: { ...currentData, memories: rows } })
    .eq("workspace_id", workspaceId)
    .eq("panel_id", brainPanelId);
}

// ── POST ────────────────────────────────────────────────────────────

/**
 * Normalize content for cheap dedup matching. Lowercase, trim, collapse
 * whitespace, drop trailing punctuation. Catches the common "I said the
 * same thing twice" case (rephrased capitalization, extra space, period
 * vs no period) without the cost of embeddings or Levenshtein.
 */
function normalizeForDedup(content: string): string {
  return content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "");
}

async function findDuplicateMemory(
  brainId: string,
  scope: "workspace" | "personal",
  authorId: string,
  content: string,
): Promise<{ id: string; content: string } | null> {
  const normalized = normalizeForDedup(content);
  if (!normalized) return null;
  const db = supabaseAdmin();
  // Pull the same-scope memories the new one would land alongside —
  // workspace memories collide with workspace, personal-mine collides
  // only with the same author's personal pool. Cap at 100 since brains
  // with thousands of memories are an anti-pattern we'd push back on
  // separately.
  let query = db
    .from("cluster_brain_memories")
    .select("id, content")
    .eq("cluster_brain_id", brainId)
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .limit(100);
  if (scope === "personal") {
    query = query.eq("author_id", authorId);
  }
  const { data } = await query;
  for (const row of data ?? []) {
    if (
      typeof row.content === "string" &&
      normalizeForDedup(row.content) === normalized
    ) {
      return { id: row.id as string, content: row.content };
    }
  }
  return null;
}

async function handlePost(request: NextRequest, { userId, workspaceId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      throw new HttpError(400, "BAD_REQUEST", "slug required");
    }
    const cluster = await getClusterBySlugForCanvas(slug, workspaceId);
    if (!cluster) {
      throw new HttpError(404, "CLUSTER_NOT_FOUND", `Cluster not found: ${slug}`);
    }

    const input = await parseJson(request, MemoryCreateSchema);
    const content = input.content;
    const scope: "workspace" | "personal" = input.scope ?? "workspace";

    const brainId = await getOrCreateBrain(cluster.id, userId, workspaceId);

    // Dedup — if a near-identical memory already exists in the same
    // scope, skip the insert and return the existing row so the caller
    // (UI or agent) can decide whether to update it instead. Returns
    // 200 with `was_duplicate: true` instead of 201.
    const duplicate = await findDuplicateMemory(brainId, scope, userId, content);
    if (duplicate) {
      return NextResponse.json(
        {
          id: duplicate.id,
          content: duplicate.content,
          scope,
          author_id: userId,
          is_mine: true,
          was_duplicate: true,
        },
        { status: 200 },
      );
    }

    const db = supabaseAdmin();
    const { data: memory, error } = await db
      .from("cluster_brain_memories")
      .insert({
        cluster_brain_id: brainId,
        cluster_id: cluster.id,
        user_id: userId,
        workspace_id: workspaceId,
        author_id: userId,
        scope,
        content,
      })
      .select("id, content, created_at, scope, author_id")
      .single();

    if (error || !memory) {
      throw error || new Error("Failed to create memory");
    }

    // Only re-sync the panel when the new row is workspace-scope —
    // personal memories never appear in the shared panel_data.
    if (scope === "workspace") {
      try {
        await syncMemoriesToPanel(cluster.id, workspaceId);
      } catch (err) {
        console.error("[memories POST] panel sync failed:", err);
      }
    }

    return NextResponse.json(
      { ...memory, is_mine: true, was_duplicate: false },
      { status: 201 }
    );
  } catch (err) {
    if (!(err instanceof HttpError)) {
      console.error("[memories POST] Error saving cluster memory:", err);
    }
    return toErrorResponse(err);
  }
}

// ── PATCH ────────────────────────────────────────────────────────────

async function handlePatch(request: NextRequest, { userId, role, workspaceId }: Ctx) {
  try {
    const input = await parseJson(request, MemoryUpdateSchema);
    const memoryId = input.memory_id;
    const content = input.content ?? null;
    const scope = input.scope ?? null;

    const clusterId = await memoryClusterIdForCanvas(memoryId, workspaceId);
    if (!clusterId) {
      throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found");
    }

    const db = supabaseAdmin();
    const { data: existing, error: existingError } = await db
      .from("cluster_brain_memories")
      .select("id, scope, author_id")
      .eq("id", memoryId)
      .single();
    if (existingError || !existing) {
      throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found");
    }

    // Permission gate: editors can edit workspace memories; only the
    // author can edit personal ones; only admin+ can promote a personal
    // memory to workspace; only the author can demote a workspace
    // memory back to personal (and only if they wrote it).
    const isAuthor = existing.author_id === userId;
    const isAdmin = role === "admin" || role === "owner";
    if (existing.scope === "personal" && !isAuthor) {
      throw new HttpError(
        403,
        "MEMORY_AUTHOR_ONLY",
        "Only the author can edit a personal memory",
      );
    }
    if (scope === "workspace" && existing.scope !== "workspace" && !isAdmin) {
      throw new HttpError(
        403,
        "MEMORY_PROMOTE_FORBIDDEN",
        "Only admins can promote a memory to workspace scope",
      );
    }
    if (scope === "personal" && existing.scope === "workspace" && !isAuthor) {
      throw new HttpError(
        403,
        "MEMORY_DEMOTE_FORBIDDEN",
        "Only the author can demote a workspace memory",
      );
    }

    const update: Record<string, unknown> = {};
    if (content !== null) update.content = content;
    if (scope !== null) update.scope = scope;

    const { data: updated, error } = await db
      .from("cluster_brain_memories")
      .update(update)
      .eq("id", memoryId)
      .select("id, content, cluster_id, scope, author_id")
      .single();

    if (error || !updated) {
      throw new HttpError(
        404,
        "MEMORY_NOT_FOUND",
        error?.message || "Memory not found",
      );
    }

    try {
      await syncMemoriesToPanel(clusterId, workspaceId);
    } catch (err) {
      console.error("[memories PATCH] panel sync failed:", err);
    }

    return NextResponse.json({
      ...updated,
      is_mine: updated.author_id === userId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ── DELETE ───────────────────────────────────────────────────────────

async function handleDelete(request: NextRequest, { userId, workspaceId }: Ctx) {
  try {
    const input = await parseJson(request, MemoryDeleteSchema);
    const memoryId = input.memory_id;

    const clusterId = await memoryClusterIdForCanvas(memoryId, workspaceId);
    if (!clusterId) {
      throw new HttpError(404, "MEMORY_NOT_FOUND", "Memory not found");
    }

    const db = supabaseAdmin();
    const { data: existing } = await db
      .from("cluster_brain_memories")
      .select("scope, author_id")
      .eq("id", memoryId)
      .single();
    // Personal memories are author-only — even an admin can't reach
    // into someone else's private notes.
    if (existing?.scope === "personal" && existing.author_id !== userId) {
      throw new HttpError(
        403,
        "MEMORY_AUTHOR_ONLY",
        "Only the author can delete a personal memory",
      );
    }

    const { error } = await db
      .from("cluster_brain_memories")
      .delete()
      .eq("id", memoryId);

    if (error) throw error;

    try {
      await syncMemoriesToPanel(clusterId, workspaceId);
    } catch (err) {
      console.error("[memories DELETE] panel sync failed:", err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

/**
 * GET  /api/clusters/[slug]/brain — fetch the cluster brain (instructions + memories)
 * PATCH /api/clusters/[slug]/brain — update the brain instructions
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { withCanvasAuth } from "@/shared/auth/with-canvas-auth";
import { validateBrainStructure } from "@/shared/prompts/skill-template";

export const dynamic = "force-dynamic";

// ── Helpers ─────────────────────────────────────────────────────────

// Look up a cluster by slug, scoped to the active canvas. Returns null
// if the cluster doesn't exist in this canvas — the caller returns 404
// so existence isn't leaked across canvases.
async function getClusterBySlugForCanvas(slug: string, canvasId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name")
    .eq("slug", slug)
    .eq("canvas_id", canvasId)
    .single();

  if (error || !data) {
    return null;
  }
  return data;
}

// ── GET ─────────────────────────────────────────────────────────────

async function handleGet(
  _request: NextRequest,
  {
    userId,
    canvasId,
    params,
  }: { userId: string; canvasId: string; params?: Record<string, string> }
) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getClusterBySlugForCanvas(slug, canvasId);
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
      .select("id, instructions, brain_version, created_at, updated_at")
      .eq("cluster_id", cluster.id)
      .single();

    if (brainError || !brain) {
      return NextResponse.json({
        instructions: "",
        memories: [],
        brain_version: 0,
      });
    }

    // Visibility filter: workspace memories visible to every member,
    // personal memories visible only to their author. Implemented via
    // an OR filter so we make one query and let Postgres apply both
    // arms in the same scan (`brain_scope_idx` covers the workspace
    // arm; `author_id_idx` covers personal-by-author).
    const { data: memories, error: memError } = await db
      .from("cluster_brain_memories")
      .select("id, content, created_at, scope, author_id")
      .eq("cluster_brain_id", brain.id)
      .or(`scope.eq.workspace,author_id.eq.${userId}`)
      .order("created_at", { ascending: true });

    if (memError) throw memError;

    return NextResponse.json({
      instructions: brain.instructions,
      brain_version: brain.brain_version ?? 1,
      updated_at: brain.updated_at,
      memories: (memories || []).map((m) => ({
        id: m.id,
        content: m.content,
        scope: m.scope,
        author_id: m.author_id,
        is_mine: m.author_id === userId,
      })),
    });
  } catch (error) {
    // Surface Supabase PostgrestError shape (code + details + hint) in
    // addition to plain Error.message so a 500 from the upsert path
    // actually tells us what column/constraint failed. Without this,
    // cluster_brains insert errors render as "Unknown error" because
    // PostgrestError isn't an Error instance.
    const err = error as Record<string, unknown> | null;
    const message =
      (err && typeof err.message === "string" && err.message) ||
      (error instanceof Error ? error.message : null) ||
      "Unknown error";
    const details = err && typeof err.details === "string" ? err.details : undefined;
    const code = err && typeof err.code === "string" ? err.code : undefined;
    const hint = err && typeof err.hint === "string" ? err.hint : undefined;
    console.error(`[cluster-brain] handler failed:`, { message, code, details, hint });
    return NextResponse.json(
      {
        error: message,
        ...(code ? { code } : {}),
        ...(details ? { details } : {}),
        ...(hint ? { hint } : {}),
      },
      { status: 500 }
    );
  }
}

// ── PATCH ───────────────────────────────────────────────────────────

async function handlePatch(
  request: NextRequest,
  {
    userId,
    canvasId,
    params,
  }: { userId: string; canvasId: string; params?: Record<string, string> }
) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getClusterBySlugForCanvas(slug, canvasId);
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

    // Advisory structural check — never rejects. Surface missing sections
    // back to the caller so the agent (or web UI) can learn what the
    // canonical skill shape looks like and self-correct next time. A
    // flat-paragraph brain still saves, just with a warning attached.
    const validation = validateBrainStructure(instructions);

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
          user_id: userId,
          canvas_id: canvasId,
          instructions,
          updated_at: now,
        })
        .select("id, cluster_id, instructions, created_at, updated_at")
        .single();

      if (error) throw error;
      brain = data;
    }

    // Mirror the new instructions into canvas_panels.panel_data for
    // this cluster's brain panel. The canvas UI reads from
    // canvas_panels (its single hydration source), not from
    // cluster_brains — without this write-through, the panel keeps
    // showing whatever was frozen into panel_data at cluster create
    // time ("_Brain not synthesized yet._") even after the brain is
    // fully populated. The realtime bridge also re-reads the fresh
    // panel_data on hydration, so reload + realtime converge.
    //
    // Non-fatal: if the canvas_panels row doesn't exist (headless
    // cluster, no canvas panel spawned), nothing to update — skip.
    try {
      const brainPanelId = `brain-${cluster.id}`;
      const { data: existingPanel } = await db
        .from("canvas_panels")
        .select("panel_data")
        .eq("canvas_id", canvasId)
        .eq("panel_id", brainPanelId)
        .eq("panel_type", "cluster-brain")
        .maybeSingle();

      if (existingPanel) {
        const currentData =
          (existingPanel.panel_data as Record<string, unknown>) ?? {};
        await db
          .from("canvas_panels")
          .update({
            panel_data: {
              ...currentData,
              instructions,
              status: "ready",
              errorMessage: null,
            },
          })
          .eq("canvas_id", canvasId)
          .eq("panel_id", brainPanelId);
      }
    } catch (syncErr) {
      // Non-fatal; the brain itself saved. Log and move on so the
      // response doesn't 500 on a canvas-layer issue.
      console.error(
        `[cluster-brain] panel_data write-through failed:`,
        syncErr instanceof Error ? syncErr.message : String(syncErr)
      );
    }

    return NextResponse.json({
      ...brain,
      structure_warning: validation.ok
        ? null
        : {
            message:
              "Brain instructions are missing canonical sections. The skill will still work, but Claude Code invocations will be less guided than with a fully-structured brain.",
            missing_sections: validation.missingSections,
            suggestion:
              "Fetch the canonical template via the `get_skill_template` MCP tool (or GET /api/cluster/synthesize) and restructure.",
          },
    });
  } catch (error) {
    // Surface Supabase PostgrestError shape (code + details + hint) in
    // addition to plain Error.message so a 500 from the upsert path
    // actually tells us what column/constraint failed. Without this,
    // cluster_brains insert errors render as "Unknown error" because
    // PostgrestError isn't an Error instance.
    const err = error as Record<string, unknown> | null;
    const message =
      (err && typeof err.message === "string" && err.message) ||
      (error instanceof Error ? error.message : null) ||
      "Unknown error";
    const details = err && typeof err.details === "string" ? err.details : undefined;
    const code = err && typeof err.code === "string" ? err.code : undefined;
    const hint = err && typeof err.hint === "string" ? err.hint : undefined;
    console.error(`[cluster-brain] handler failed:`, { message, code, details, hint });
    return NextResponse.json(
      {
        error: message,
        ...(code ? { code } : {}),
        ...(details ? { details } : {}),
        ...(hint ? { hint } : {}),
      },
      { status: 500 }
    );
  }
}

export const GET = withCanvasAuth(handleGet);
export const PATCH = withCanvasAuth(handlePatch, { minRole: "editor" });

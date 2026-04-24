import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import type { CanvasContextPayload } from "../canvas-context";
import { enforceClusterEditScope, getClusterForUser } from "./cluster-scope";
import type { ToolResult } from "./types";

const supabase = supabaseAdmin();

/** Tool: list_user_clusters — returns slug/name/panel_count per cluster. */
export async function executeListUserClusters(
  _input: Record<string, unknown>,
  userId?: string
): Promise<ToolResult> {
  if (!userId) return { result: JSON.stringify({ error: "Not authenticated." }) };
  const { data, error } = await supabase
    .from("clusters")
    .select("id, slug, name, panel_ids")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    return { result: JSON.stringify({ error: error.message }) };
  }
  const clusters = (data || []).map((c) => ({
    slug: c.slug,
    name: c.name,
    panel_count: Array.isArray(c.panel_ids) ? c.panel_ids.length : 0,
  }));
  return { result: JSON.stringify({ clusters }) };
}

/** Tool: list_cluster_brain_memories — returns instructions + memory rows. */
export async function executeListClusterBrainMemories(
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload
): Promise<ToolResult> {
  if (!userId) return { result: JSON.stringify({ error: "Not authenticated." }) };
  const clusterSlug = input.cluster_slug as string;
  const scopeError = enforceClusterEditScope(clusterSlug, canvasContext);
  if (scopeError) return { result: JSON.stringify({ error: scopeError }) };

  const clusterRes = await getClusterForUser(clusterSlug, userId);
  if (!clusterRes.ok) return { result: JSON.stringify({ error: clusterRes.error }) };

  const { data: brain } = await supabase
    .from("cluster_brains")
    .select("id, instructions")
    .eq("cluster_id", clusterRes.cluster.id)
    .single();

  if (!brain) {
    return {
      result: JSON.stringify({
        cluster: { slug: clusterRes.cluster.slug, name: clusterRes.cluster.name },
        instructions: "",
        memories: [],
      }),
    };
  }

  const { data: memories } = await supabase
    .from("cluster_brain_memories")
    .select("id, content, created_at")
    .eq("cluster_brain_id", brain.id)
    .order("created_at", { ascending: true });

  return {
    result: JSON.stringify({
      cluster: { slug: clusterRes.cluster.slug, name: clusterRes.cluster.name },
      instructions: brain.instructions || "",
      memories: (memories || []).map((m) => ({ id: m.id, content: m.content })),
    }),
  };
}

/** Tool: add_cluster_brain_memory — append a memory; upserts the brain row. */
export async function executeAddClusterBrainMemory(
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload
): Promise<ToolResult> {
  if (!userId) return { result: JSON.stringify({ error: "Not authenticated." }) };
  const clusterSlug = input.cluster_slug as string;
  const content = input.content as string;
  if (!content || typeof content !== "string") {
    return { result: JSON.stringify({ error: "content (string) is required" }) };
  }
  const scopeError = enforceClusterEditScope(clusterSlug, canvasContext);
  if (scopeError) return { result: JSON.stringify({ error: scopeError }) };

  const clusterRes = await getClusterForUser(clusterSlug, userId);
  if (!clusterRes.ok) return { result: JSON.stringify({ error: clusterRes.error }) };

  // Get-or-create the brain row.
  const { data: upserted, error: brainErr } = await supabase
    .from("cluster_brains")
    .upsert(
      { cluster_id: clusterRes.cluster.id, instructions: "" },
      { onConflict: "cluster_id", ignoreDuplicates: true }
    )
    .select("id")
    .single();
  let brainId: string | undefined = upserted?.id;
  if (!brainId) {
    // ignoreDuplicates returns no row when the brain already existed;
    // fetch it explicitly.
    const { data: existing } = await supabase
      .from("cluster_brains")
      .select("id")
      .eq("cluster_id", clusterRes.cluster.id)
      .single();
    brainId = existing?.id;
  }
  if (!brainId) {
    return {
      result: JSON.stringify({
        error: `Failed to initialize cluster brain: ${brainErr?.message || "unknown"}`,
      }),
    };
  }

  const { data: memory, error } = await supabase
    .from("cluster_brain_memories")
    .insert({ cluster_brain_id: brainId, content })
    .select("id, content")
    .single();
  if (error || !memory) {
    return { result: JSON.stringify({ error: error?.message || "Failed to save memory" }) };
  }
  return {
    result: JSON.stringify({
      status: "ok",
      cluster_slug: clusterRes.cluster.slug,
      memory: { id: memory.id, content: memory.content },
    }),
  };
}

/** Tool: update_cluster_brain_memory — edit one memory's content. */
export async function executeUpdateClusterBrainMemory(
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload
): Promise<ToolResult> {
  if (!userId) return { result: JSON.stringify({ error: "Not authenticated." }) };
  const clusterSlug = input.cluster_slug as string;
  const memoryId = input.memory_id as string;
  const content = input.content as string;
  if (!memoryId || typeof memoryId !== "string") {
    return { result: JSON.stringify({ error: "memory_id is required" }) };
  }
  if (!content || typeof content !== "string") {
    return { result: JSON.stringify({ error: "content is required" }) };
  }
  const scopeError = enforceClusterEditScope(clusterSlug, canvasContext);
  if (scopeError) return { result: JSON.stringify({ error: scopeError }) };

  const clusterRes = await getClusterForUser(clusterSlug, userId);
  if (!clusterRes.ok) return { result: JSON.stringify({ error: clusterRes.error }) };

  // Verify the memory actually belongs to this cluster's brain —
  // prevents cross-cluster edits when scope is "canvas".
  const { data: memRow } = await supabase
    .from("cluster_brain_memories")
    .select("id, cluster_brains!inner(cluster_id)")
    .eq("id", memoryId)
    .single();
  const ownedClusterId = (memRow as unknown as {
    cluster_brains?: { cluster_id?: string };
  } | null)?.cluster_brains?.cluster_id;
  if (!ownedClusterId || ownedClusterId !== clusterRes.cluster.id) {
    return {
      result: JSON.stringify({
        error: `Memory ${memoryId} does not belong to cluster ${clusterSlug}.`,
      }),
    };
  }

  const { data: updated, error } = await supabase
    .from("cluster_brain_memories")
    .update({ content })
    .eq("id", memoryId)
    .select("id, content")
    .single();
  if (error || !updated) {
    return { result: JSON.stringify({ error: error?.message || "Update failed" }) };
  }
  return {
    result: JSON.stringify({
      status: "ok",
      cluster_slug: clusterRes.cluster.slug,
      memory: { id: updated.id, content: updated.content },
    }),
  };
}

/** Tool: remove_cluster_brain_memory — permanently delete a memory. */
export async function executeRemoveClusterBrainMemory(
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload
): Promise<ToolResult> {
  if (!userId) return { result: JSON.stringify({ error: "Not authenticated." }) };
  const clusterSlug = input.cluster_slug as string;
  const memoryId = input.memory_id as string;
  if (!memoryId || typeof memoryId !== "string") {
    return { result: JSON.stringify({ error: "memory_id is required" }) };
  }
  const scopeError = enforceClusterEditScope(clusterSlug, canvasContext);
  if (scopeError) return { result: JSON.stringify({ error: scopeError }) };

  const clusterRes = await getClusterForUser(clusterSlug, userId);
  if (!clusterRes.ok) return { result: JSON.stringify({ error: clusterRes.error }) };

  const { data: memRow } = await supabase
    .from("cluster_brain_memories")
    .select("id, cluster_brains!inner(cluster_id)")
    .eq("id", memoryId)
    .single();
  const ownedClusterId = (memRow as unknown as {
    cluster_brains?: { cluster_id?: string };
  } | null)?.cluster_brains?.cluster_id;
  if (!ownedClusterId || ownedClusterId !== clusterRes.cluster.id) {
    return {
      result: JSON.stringify({
        error: `Memory ${memoryId} does not belong to cluster ${clusterSlug}.`,
      }),
    };
  }

  const { error } = await supabase
    .from("cluster_brain_memories")
    .delete()
    .eq("id", memoryId);
  if (error) {
    return { result: JSON.stringify({ error: error.message }) };
  }
  return {
    result: JSON.stringify({
      status: "ok",
      cluster_slug: clusterRes.cluster.slug,
      removed_memory_id: memoryId,
    }),
  };
}

/** Tool: rewrite_cluster_brain_instructions — replace instructions text. */
export async function executeRewriteClusterBrainInstructions(
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload
): Promise<ToolResult> {
  if (!userId) return { result: JSON.stringify({ error: "Not authenticated." }) };
  const clusterSlug = input.cluster_slug as string;
  const instructions = input.instructions as string;
  if (typeof instructions !== "string") {
    return { result: JSON.stringify({ error: "instructions (string) is required" }) };
  }
  const scopeError = enforceClusterEditScope(clusterSlug, canvasContext);
  if (scopeError) return { result: JSON.stringify({ error: scopeError }) };

  const clusterRes = await getClusterForUser(clusterSlug, userId);
  if (!clusterRes.ok) return { result: JSON.stringify({ error: clusterRes.error }) };

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("cluster_brains")
    .select("id")
    .eq("cluster_id", clusterRes.cluster.id)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("cluster_brains")
      .update({ instructions, updated_at: now })
      .eq("id", existing.id);
    if (error) {
      return { result: JSON.stringify({ error: error.message }) };
    }
  } else {
    const { error } = await supabase
      .from("cluster_brains")
      .insert({
        cluster_id: clusterRes.cluster.id,
        instructions,
        updated_at: now,
      });
    if (error) {
      return { result: JSON.stringify({ error: error.message }) };
    }
  }

  return {
    result: JSON.stringify({
      status: "ok",
      cluster_slug: clusterRes.cluster.slug,
      instructions_length: instructions.length,
    }),
  };
}

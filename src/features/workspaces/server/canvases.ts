import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { WorkspaceCanvas } from "../types";
import { mapWorkspaceCanvasRow, type WorkspaceCanvasRow } from "./dto";
import type { CanvasCreateInput } from "../schema";

const CANVAS_COLS = "id, workspace_id, name, slug, created_at, updated_at";

const DEFAULT_CANVAS_FALLBACK_SLUG = "canvas";

/**
 * Reserved canvas slugs — shadowed by static workspace sub-routes
 * (`/[workspaceSlug]/settings`, `/knowledge`, `/skills`, `/activity`,
 * `/chat`, `/overview`). Static segments win over dynamic in the
 * Next.js router, so a canvas with one of these slugs would be
 * unreachable via URL even though the row exists. Refuse the collision
 * at slug-generation time. Add any new top-level workspace sub-route
 * here when you create it.
 */
const RESERVED_CANVAS_SLUGS: ReadonlySet<string> = new Set([
  "activity",
  "chat",
  "knowledge",
  "overview",
  "settings",
  "skills",
]);

/**
 * Slugify a canvas name within a workspace, deduplicating against
 * existing canvas slugs AND reserved sub-route names. Mirrors
 * `slugifyWorkspaceName` but scoped per-workspace, with a different
 * fallback word.
 */
function slugifyCanvasName(name: string, existing: string[]): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || DEFAULT_CANVAS_FALLBACK_SLUG;

  const taken = new Set(existing);
  const isAvailable = (candidate: string) =>
    !taken.has(candidate) && !RESERVED_CANVAS_SLUGS.has(candidate);

  if (isAvailable(base)) return base;
  let n = 2;
  while (!isAvailable(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ── Repository ─────────────────────────────────────────────────────

export async function listCanvasesForWorkspace(
  workspaceId: string
): Promise<WorkspaceCanvas[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvases")
    .select(CANVAS_COLS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as WorkspaceCanvasRow[]).map(mapWorkspaceCanvasRow);
}

export async function findCanvasBySlug(
  workspaceId: string,
  canvasSlug: string
): Promise<WorkspaceCanvas | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvases")
    .select(CANVAS_COLS)
    .eq("workspace_id", workspaceId)
    .eq("slug", canvasSlug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapWorkspaceCanvasRow(data as WorkspaceCanvasRow) : null;
}

// ── Service ────────────────────────────────────────────────────────

/**
 * Create a new canvas inside a workspace. Slug is derived from `name`,
 * deduped against the workspace's existing canvas slugs. Caller is
 * expected to have already verified workspace membership + role.
 *
 * The migration backfills one canvas per workspace (slug='main'); this
 * function is the path for adding a second / third canvas. Currently the
 * UI only assumes one canvas per workspace, so this is here to unblock
 * downstream phases rather than for immediate user-facing use.
 */
export async function createCanvas(
  workspaceId: string,
  input: CanvasCreateInput
): Promise<WorkspaceCanvas> {
  const db = supabaseAdmin();
  const existing = await listCanvasesForWorkspace(workspaceId);
  const slug = slugifyCanvasName(
    input.name,
    existing.map((c) => c.slug)
  );

  const { data, error } = await db
    .from("canvases")
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      slug,
    })
    .select(CANVAS_COLS)
    .single();

  if (error || !data) {
    throw new HttpError(
      500,
      "WORKSPACE_CANVAS_CREATE_FAILED",
      error?.message ?? "Failed to create canvas"
    );
  }
  return mapWorkspaceCanvasRow(data as WorkspaceCanvasRow);
}

/**
 * Idempotent: ensures a workspace has at least one canvas. Returns the
 * default canvas (slug='main') if it exists, otherwise creates and
 * returns it. Used by signup provisioning and any path that needs to
 * land the user on a canvas without first checking whether one exists.
 */
export async function ensureDefaultCanvas(
  workspaceId: string
): Promise<WorkspaceCanvas> {
  const existing = await findCanvasBySlug(workspaceId, "main");
  if (existing) return existing;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvases")
    .insert({
      workspace_id: workspaceId,
      name: "Main",
      slug: "main",
    })
    .select(CANVAS_COLS)
    .single();

  if (error || !data) {
    // Concurrent insert lost the race — re-read and return whichever
    // row landed first. Postgres unique-violation code is 23505.
    if ((error as { code?: string } | null)?.code === "23505") {
      const reread = await findCanvasBySlug(workspaceId, "main");
      if (reread) return reread;
    }
    throw new HttpError(
      500,
      "WORKSPACE_CANVAS_BOOTSTRAP_FAILED",
      error?.message ?? "Failed to provision default canvas"
    );
  }
  return mapWorkspaceCanvasRow(data as WorkspaceCanvasRow);
}

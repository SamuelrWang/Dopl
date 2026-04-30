import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Canvas, CanvasMembership, Role } from "../types";
import {
  type CanvasMemberRow,
  type CanvasRow,
  mapCanvasRow,
  mapMemberRow,
} from "./dto";

const CANVAS_COLS = "id, owner_id, name, slug, description, created_at, updated_at";
const MEMBER_COLS =
  "canvas_id, user_id, role, status, joined_at, invited_by, invited_at";

export async function findCanvasById(canvasId: string): Promise<Canvas | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvases")
    .select(CANVAS_COLS)
    .eq("id", canvasId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCanvasRow(data as CanvasRow) : null;
}

export async function findCanvasBySlug(
  ownerId: string,
  slug: string
): Promise<Canvas | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvases")
    .select(CANVAS_COLS)
    .eq("owner_id", ownerId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCanvasRow(data as CanvasRow) : null;
}

/**
 * Membership-aware slug lookup. Walks every canvas the user is an
 * active member of, returns the one whose slug matches. Used by the
 * canvas page + settings routes so invited members can reach a canvas
 * they don't own. Returns null if no membership-by-slug match.
 *
 * Slugs are unique per (owner, slug) — two different owners could each
 * have a canvas with the same slug (e.g. "default"). Users joining
 * canvases from multiple owners would in principle hit a collision; we
 * resolve by preferring the canvas the caller themselves owns, then
 * fall back to the first non-owned membership match. Callers that need
 * stricter resolution should pass a canvas UUID, not slug, to the API.
 */
export async function findMemberCanvasBySlug(
  userId: string,
  slug: string
): Promise<Canvas | null> {
  const owned = await findCanvasBySlug(userId, slug);
  if (owned) return owned;
  const memberships = await listCanvasesForUser(userId);
  return memberships.find((c) => c.slug === slug) ?? null;
}

/**
 * Default canvas resolver — every user has one canvas with slug='default'
 * (created by the P0 backfill). Returns null only if a brand-new user
 * predates the trigger that should create one for them on signup. Phase 1
 * code paths fall back to this when no `X-Canvas-Id` header is provided.
 */
export async function findDefaultCanvasForUser(
  userId: string
): Promise<Canvas | null> {
  return findCanvasBySlug(userId, "default");
}

export async function listCanvasesForUser(userId: string): Promise<Canvas[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvas_members")
    .select(`canvas:canvases!inner(${CANVAS_COLS})`)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  // Supabase typings model nested joins as arrays even when the join is
  // 1:1; cast through unknown so we can flatten the canvas object.
  const rows = (data ?? []) as unknown as Array<{ canvas: CanvasRow | CanvasRow[] }>;
  const canvases: Canvas[] = [];
  for (const row of rows) {
    const c = Array.isArray(row.canvas) ? row.canvas[0] : row.canvas;
    if (c) canvases.push(mapCanvasRow(c));
  }
  return canvases.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function findMembership(
  canvasId: string,
  userId: string
): Promise<CanvasMembership | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvas_members")
    .select(MEMBER_COLS)
    .eq("canvas_id", canvasId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapMemberRow(data as CanvasMemberRow) : null;
}

export async function listMembers(canvasId: string): Promise<CanvasMembership[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvas_members")
    .select(MEMBER_COLS)
    .eq("canvas_id", canvasId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as CanvasMemberRow[]).map(mapMemberRow);
}

export interface CreateCanvasArgs {
  ownerId: string;
  name: string;
  slug: string;
  description?: string | null;
}

export async function insertCanvasWithOwnerMembership(
  args: CreateCanvasArgs
): Promise<Canvas> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvases")
    .insert({
      owner_id: args.ownerId,
      name: args.name,
      slug: args.slug,
      description: args.description ?? null,
    })
    .select(CANVAS_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create canvas");
  const canvas = mapCanvasRow(data as CanvasRow);

  const { error: memberError } = await db.from("canvas_members").insert({
    canvas_id: canvas.id,
    user_id: args.ownerId,
    role: "owner" as Role,
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) {
    // Roll back the canvas insert so we don't leave an orphan.
    await db.from("canvases").delete().eq("id", canvas.id);
    throw memberError;
  }
  return canvas;
}

export async function updateCanvas(
  canvasId: string,
  patch: { name?: string; slug?: string; description?: string | null }
): Promise<Canvas> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.description !== undefined) update.description = patch.description;
  const { data, error } = await db
    .from("canvases")
    .update(update)
    .eq("id", canvasId)
    .select(CANVAS_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update canvas");
  return mapCanvasRow(data as CanvasRow);
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("canvases").delete().eq("id", canvasId);
  if (error) throw error;
}

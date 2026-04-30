import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Canvas, CanvasMembership, Role } from "../types";
import { meetsMinRole } from "../types";
import { slugifyCanvasName } from "../slug";
import {
  deleteCanvas,
  findCanvasById,
  findCanvasBySlug,
  findDefaultCanvasForUser,
  findMemberCanvasBySlug,
  findMembership,
  insertCanvasWithOwnerMembership,
  listCanvasesForUser,
  listMembers,
  updateCanvas,
} from "./repository";

export interface ResolvedMembership {
  canvas: Canvas;
  membership: CanvasMembership;
}

/**
 * Authoritative auth lookup used by `withCanvasAuth`. Returns the canvas
 * + the caller's active membership, or throws an HttpError. Never returns
 * null — `404` is the cleanest response for both "not a member" and
 * "canvas does not exist" so existence isn't an oracle.
 */
export async function resolveMembershipOrThrow(
  canvasId: string,
  userId: string
): Promise<ResolvedMembership> {
  const canvas = await findCanvasById(canvasId);
  if (!canvas) throw new HttpError(404, "CANVAS_NOT_FOUND", "Canvas not found");
  const membership = await findMembership(canvasId, userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "CANVAS_NOT_FOUND", "Canvas not found");
  }
  return { canvas, membership };
}

/**
 * Resolve the active canvas for an authenticated request. Used by
 * `withCanvasAuth` — header takes priority, default canvas is the
 * fallback for during-rollout compatibility (Phase 1) and any UI that
 * hasn't been wired to send the header yet.
 */
export async function resolveActiveCanvas(
  userId: string,
  headerCanvasId: string | null
): Promise<ResolvedMembership> {
  if (headerCanvasId) {
    return resolveMembershipOrThrow(headerCanvasId, userId);
  }
  const defaultCanvas = await findDefaultCanvasForUser(userId);
  if (!defaultCanvas) {
    // The P0 backfill creates one for every existing auth.users row;
    // a missing default canvas means a user signed up after the
    // backfill and the signup hook hasn't yet been added (Phase 2 work).
    // Auto-create one inline so the request can proceed.
    const created = await ensureDefaultCanvas(userId);
    const membership = await findMembership(created.id, userId);
    if (!membership) {
      throw new HttpError(
        500,
        "CANVAS_BOOTSTRAP_FAILED",
        "Default canvas missing membership row"
      );
    }
    return { canvas: created, membership };
  }
  return resolveMembershipOrThrow(defaultCanvas.id, userId);
}

/**
 * Idempotent: creates the user's default canvas if it doesn't exist yet.
 * Called from `resolveActiveCanvas` and from signup hooks (Phase 2).
 *
 * Two concurrent calls for a brand-new user can both pass the existence
 * check and race to INSERT — the second hits the (owner_id, slug)
 * unique constraint and 500s. We catch that error code (Postgres 23505)
 * and re-read the row, returning whichever insert won.
 */
export async function ensureDefaultCanvas(userId: string): Promise<Canvas> {
  const existing = await findDefaultCanvasForUser(userId);
  if (existing) return existing;
  try {
    return await insertCanvasWithOwnerMembership({
      ownerId: userId,
      name: "My Canvas",
      slug: "default",
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : null;
    if (code === "23505") {
      const winner = await findDefaultCanvasForUser(userId);
      if (winner) return winner;
    }
    throw err;
  }
}

export async function listMyCanvases(userId: string): Promise<Canvas[]> {
  return listCanvasesForUser(userId);
}

export async function createCanvasForUser(
  userId: string,
  input: { name: string; description?: string | null }
): Promise<Canvas> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("canvases")
    .select("slug")
    .eq("owner_id", userId);
  const taken = (existing ?? []).map((r) => (r as { slug: string }).slug);
  const slug = slugifyCanvasName(input.name, taken);
  return insertCanvasWithOwnerMembership({
    ownerId: userId,
    name: input.name,
    slug,
    description: input.description ?? null,
  });
}

export async function renameCanvas(
  canvasId: string,
  userId: string,
  patch: { name?: string; description?: string | null }
): Promise<Canvas> {
  const { canvas, membership } = await resolveMembershipOrThrow(canvasId, userId);
  if (!meetsMinRole(membership.role, "admin")) {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      "Only admins can edit canvas settings"
    );
  }

  const update: { name?: string; slug?: string; description?: string | null } = {};
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.name && patch.name !== canvas.name) {
    update.name = patch.name;
    const db = supabaseAdmin();
    const { data: existing } = await db
      .from("canvases")
      .select("slug")
      .eq("owner_id", canvas.ownerId)
      .neq("id", canvasId);
    const taken = (existing ?? []).map((r) => (r as { slug: string }).slug);
    update.slug = slugifyCanvasName(patch.name, taken);
  }
  if (Object.keys(update).length === 0) return canvas;
  return updateCanvas(canvasId, update);
}

export async function deleteCanvasForUser(
  canvasId: string,
  userId: string
): Promise<void> {
  const { membership } = await resolveMembershipOrThrow(canvasId, userId);
  if (membership.role !== "owner") {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      "Only the canvas owner can delete it"
    );
  }
  await deleteCanvas(canvasId);
}

export async function listCanvasMembers(
  canvasId: string,
  userId: string
): Promise<CanvasMembership[]> {
  await resolveMembershipOrThrow(canvasId, userId);
  return listMembers(canvasId);
}

export function requireMinRole(role: Role, min: Role): void {
  if (!meetsMinRole(role, min)) {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      `Requires ${min} role or higher`
    );
  }
}

export function findCanvasBySlugForUser(
  ownerId: string,
  slug: string
): Promise<Canvas | null> {
  return findCanvasBySlug(ownerId, slug);
}

/**
 * Membership-aware slug lookup — finds a canvas the user can access
 * regardless of ownership. Used by `/canvas/[slug]` and the settings
 * page so invited members reach the canvas via its public URL.
 */
export function findCanvasForMember(
  userId: string,
  slug: string
): Promise<Canvas | null> {
  return findMemberCanvasBySlug(userId, slug);
}

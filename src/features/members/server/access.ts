import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import { listCanvasesForWorkspace } from "@/features/workspaces/server/canvases";
import {
  defaultLevelForRole,
  meetsLevel,
  type AccessLevel,
  type ResourceType,
} from "../access-defaults";

export type { AccessLevel, ResourceType };

export interface AccessOverrideRow {
  resourceType: ResourceType;
  resourceId: string;
  level: AccessLevel;
}

interface OverrideRow {
  resource_type: ResourceType;
  resource_id: string;
  level: AccessLevel;
}

/**
 * Resolve a member's effective access level on a single resource.
 * Owner/admin short-circuit to "edit" — they're never subject to the
 * matrix. Otherwise look up the override row, falling back to the
 * role default.
 *
 * Returns null if the user isn't an active member of the workspace.
 */
export async function getResourceAccess(
  userId: string,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<AccessLevel | null> {
  const membership = await findMembership(workspaceId, userId);
  if (!membership || membership.status !== "active") return null;

  if (meetsMinRole(membership.role, "admin")) return "edit";

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_resource_access")
    .select("level")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();
  if (error) throw error;

  if (data) return (data as { level: AccessLevel }).level;
  return defaultLevelForRole(membership.role);
}

/**
 * Throws HttpError(403) if the caller doesn't have at least the
 * required level on the resource. Use at the API-route boundary on
 * MCP / external API key requests.
 */
export async function requireResourceAccess(
  userId: string,
  workspaceId: string,
  resourceType: ResourceType,
  resourceId: string,
  requiredLevel: AccessLevel
): Promise<void> {
  const level = await getResourceAccess(userId, workspaceId, resourceType, resourceId);
  if (level === null) {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  if (!meetsLevel(level, requiredLevel)) {
    throw new HttpError(
      403,
      "RESOURCE_ACCESS_DENIED",
      `Your access on this ${resourceType.replace("_", " ")} is read-only`
    );
  }
}

/**
 * List every override row for a single member. Used by the matrix UI
 * to render their current toggles. The UI joins these against the full
 * resource list (KBs, skills, canvases) it fetches separately, falling
 * back to the role default for resources without an override.
 */
export async function listMemberOverrides(
  workspaceId: string,
  callerId: string,
  targetUserId: string
): Promise<AccessOverrideRow[]> {
  await requireAdmin(workspaceId, callerId);

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_resource_access")
    .select("resource_type, resource_id, level")
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) throw error;

  return ((data ?? []) as OverrideRow[]).map((r) => ({
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    level: r.level,
  }));
}

/**
 * Set (upsert) a per-(member, resource) access override. Caller must
 * be admin+ on the workspace. Refuses if the target is owner/admin
 * (their access is implicit edit, not configurable).
 */
export async function setResourceAccessOverride(
  workspaceId: string,
  callerId: string,
  targetUserId: string,
  resourceType: ResourceType,
  resourceId: string,
  level: AccessLevel
): Promise<void> {
  await requireAdmin(workspaceId, callerId);

  const target = await findMembership(workspaceId, targetUserId);
  if (!target || target.status !== "active") {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member not found");
  }
  if (meetsMinRole(target.role, "admin")) {
    throw new HttpError(
      400,
      "TARGET_HAS_IMPLICIT_ACCESS",
      "Owners and admins always have edit access — overrides don't apply"
    );
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("workspace_resource_access")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: targetUserId,
        resource_type: resourceType,
        resource_id: resourceId,
        level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id,resource_type,resource_id" }
    );
  if (error) throw error;
}

/**
 * Canvas enforcement helper. The current `canvas_state` table is scoped
 * per-workspace (not per-canvas), so we resolve to the workspace's
 * canvas list and check access against the first canvas. With one
 * canvas per workspace (today's reality) this is exact; once a
 * workspace has multiple canvases this becomes coarse — promote to
 * per-canvas enforcement when the canvas write paths start passing
 * canvas_id explicitly.
 *
 * Only called from MCP / API-key request paths. Session callers skip
 * this entirely. No-op when the workspace has no canvases yet.
 */
export async function requireWorkspaceCanvasAccess(
  userId: string,
  workspaceId: string,
  level: AccessLevel
): Promise<void> {
  const canvases = await listCanvasesForWorkspace(workspaceId);
  if (canvases.length === 0) return;
  await requireResourceAccess(userId, workspaceId, "canvas", canvases[0].id, level);
}

/**
 * Convenience wrapper for canvas write routes. Returns a NextResponse
 * to short-circuit the handler on denial, or null on success. Skips the
 * check entirely for session-cookie callers (no apiKeyId).
 */
export async function denyIfNoCanvasWrite(ctx: {
  apiKeyId?: string;
  userId: string;
  workspaceId: string;
}): Promise<NextResponse | null> {
  if (!ctx.apiKeyId) return null;
  try {
    await requireWorkspaceCanvasAccess(ctx.userId, ctx.workspaceId, "edit");
    return null;
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    throw err;
  }
}

async function requireAdmin(workspaceId: string, callerId: string): Promise<void> {
  const membership = await findMembership(workspaceId, callerId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  if (!meetsMinRole(membership.role, "admin")) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Admin role or higher required"
    );
  }
}

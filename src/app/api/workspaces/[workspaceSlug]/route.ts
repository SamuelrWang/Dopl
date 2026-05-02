import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { WorkspaceUpdateSchema } from "@/features/workspaces/schema";
import {
  deleteWorkspaceForUser,
  findWorkspaceForMember,
  renameWorkspace,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug] — fetch one workspace by slug, scoped to the
 * caller. Looks up by (owner_id, slug) first; if not found, falls back
 * to membership-by-slug across workspaces the caller is a member of.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }

    // Owner-side lookup is the fast path. Most calls hit a workspace the
    // caller owns. Membership lookup (workspaces owned by other users that
    // the caller has been invited to) lands in Phase 4 and joins through
    // workspace_members.
    const workspace = await findWorkspaceForMember(userId, workspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const { membership } = await resolveMembershipOrThrow(workspace.id, userId);
    return NextResponse.json({ workspace, role: membership.role });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * PATCH /api/workspaces/[workspaceSlug] — rename / edit description. Admin+ only;
 * `renameWorkspace` enforces the role gate.
 */
export const PATCH = withUserAuth(async (request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }
    const workspace = await findWorkspaceForMember(userId, workspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const input = await parseJson(request, WorkspaceUpdateSchema);
    const updated = await renameWorkspace(workspace.id, userId, input);
    return NextResponse.json({ workspace: updated });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * DELETE /api/workspaces/[workspaceSlug] — owner-only. Cascades clusters / panels /
 * brain / memberships / invitations via FK ON DELETE CASCADE.
 */
export const DELETE = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }
    const workspace = await findWorkspaceForMember(userId, workspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    await deleteWorkspaceForUser(workspace.id, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

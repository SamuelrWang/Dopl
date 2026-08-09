import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  resolveMembershipOrThrow,
  requireMinRole,
  updateWorkspaceIcon,
} from "@/features/workspaces/server/service";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  uploadWorkspaceIcon,
  clearWorkspaceIcon,
} from "@/features/workspaces/server/icon";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

function errorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workspaces/[workspaceSlug]/icon", err);
}

/**
 * POST /api/workspaces/[workspaceSlug]/icon — upload a workspace icon image
 * (multipart `file`). Admin+ only. Gates the role before touching storage so
 * a non-admin can't burn an upload, then persists the public URL.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }
    const workspace = await resolveApiWorkspace(workspaceSlug, userId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const { membership } = await resolveMembershipOrThrow(workspace.id, userId);
    requireMinRole(membership.role, "admin");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "FILE_REQUIRED", "An image file is required");
    }
    const iconUrl = await uploadWorkspaceIcon(workspace.id, file);
    const updated = await updateWorkspaceIcon(workspace.id, userId, iconUrl);
    return NextResponse.json({ workspace: updated });
  } catch (err) {
    return errorResponse(err);
  }
});

/**
 * DELETE /api/workspaces/[workspaceSlug]/icon — clear the workspace icon.
 * Admin+ only (enforced by `updateWorkspaceIcon`), then purges storage.
 */
export const DELETE = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }
    const workspace = await resolveApiWorkspace(workspaceSlug, userId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const updated = await updateWorkspaceIcon(workspace.id, userId, null);
    await clearWorkspaceIcon(workspace.id);
    return NextResponse.json({ workspace: updated });
  } catch (err) {
    return errorResponse(err);
  }
});

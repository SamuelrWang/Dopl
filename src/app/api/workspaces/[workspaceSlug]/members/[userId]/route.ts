import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  removeMember,
  updateMemberRole,
} from "@/features/workspaces/server/invitations";

const RoleUpdateSchema = z.object({
  role: z.enum(["owner", "admin", "editor", "viewer"]),
});

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * PATCH /api/workspaces/[workspaceSlug]/members/[userId] — change a member's role.
 * Admin+ only. Last-owner protection enforced inside `updateMemberRole`.
 */
export const PATCH = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      const targetUserId = params?.userId;
      if (!workspaceSlug || !targetUserId) {
        return NextResponse.json({ error: "workspaceSlug + userId required" }, { status: 400 });
      }
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const { role } = await parseJson(request, RoleUpdateSchema);
      await updateMemberRole(workspace.id, userId, targetUserId, role);
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

/**
 * DELETE /api/workspaces/[workspaceSlug]/members/[userId] — remove a member.
 * Admin+ only. Cannot remove last owner.
 */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      const targetUserId = params?.userId;
      if (!workspaceSlug || !targetUserId) {
        return NextResponse.json({ error: "workspaceSlug + userId required" }, { status: 400 });
      }
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      await removeMember(workspace.id, userId, targetUserId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

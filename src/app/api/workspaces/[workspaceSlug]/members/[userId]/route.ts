import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  removeMember,
  updateMemberRole,
} from "@/features/workspaces/server/invitations";

const RoleUpdateSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** PATCH — change a member's role. Admin+; last-owner protection inside `updateMemberRole`. */
export const PATCH = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      const targetUserId = params?.userId;
      if (!workspaceSlug || !targetUserId) {
        return NextResponse.json({ error: "workspaceSlug + userId required" }, { status: 400 });
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const { role } = await parseJson(request, RoleUpdateSchema);
      await updateMemberRole(workspace.id, userId, targetUserId, role);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/members/[userId]", err);
    }
  },
  // sessionOnly: admin action, not an agent one.
  { sessionOnly: true }
);

/** DELETE — remove a member. Admin+; cannot remove the last owner. */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      const targetUserId = params?.userId;
      if (!workspaceSlug || !targetUserId) {
        return NextResponse.json({ error: "workspaceSlug + userId required" }, { status: 400 });
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      await removeMember(workspace.id, userId, targetUserId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/members/[userId]", err);
    }
  },
  // sessionOnly: admin action, not an agent one.
  { sessionOnly: true }
);

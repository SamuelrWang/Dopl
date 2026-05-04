import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { listMyAccess } from "@/features/members/server/access";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/my-access — return the caller's
 * effective access on every resource in this workspace, in one round
 * trip. Used by the sidebar to badge each KB/skill row with a read or
 * edit icon. Shape:
 *   {
 *     defaultLevel: "read" | "edit",
 *     overrides: { resourceType, resourceId, level }[]
 *   }
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json(
          { error: "workspaceSlug required" },
          { status: 400 }
        );
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 }
        );
      }
      const result = await listMyAccess(workspace.id, userId);
      if (!result) {
        return NextResponse.json(
          { error: "Not a member" },
          { status: 403 }
        );
      }
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

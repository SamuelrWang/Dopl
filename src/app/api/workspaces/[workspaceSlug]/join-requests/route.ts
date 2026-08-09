import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { listPendingJoinRequests } from "@/features/workspaces/server/join-links";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** GET /api/workspaces/[workspaceSlug]/join-requests — pending approval queue. Admin+. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const requests = await listPendingJoinRequests(workspace.id, userId);
      return NextResponse.json({ requests });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/join-requests", err);
    }
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceOverviewCounts } from "@/features/workspaces/server/service";
import { isMcpConnected } from "@/features/onboarding/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET — the overview header in one round trip: `{ knowledgeBases, skills, members,
 * isMcpConnected }`. Any active member; `resolveApiWorkspace` is membership-scoped so a
 * non-member 404s. The alternative is three full payloads for three integers.
 * `isMcpConnected` failures degrade to `false` (counts to 0 in the service): a stale badge beats
 * a 500 on the workspace home.
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json(
          {
            error: {
              code: "MISSING_WORKSPACE_SLUG",
              message: "workspaceSlug required",
            },
          },
          { status: 400 }
        );
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json(
          {
            error: {
              code: "WORKSPACE_NOT_FOUND",
              message: "Workspace not found",
            },
          },
          { status: 404 }
        );
      }

      const [counts, connected] = await Promise.all([
        getWorkspaceOverviewCounts(workspace.id),
        isMcpConnected(userId).catch(() => false),
      ]);

      // ⚠ Per-user data (the MCP badge is the caller's) — never CDN-cacheable by URL alone.
      return NextResponse.json(
        { ...counts, isMcpConnected: connected },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/overview-counts", err);
    }
  }
);

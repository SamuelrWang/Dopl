import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceOverview } from "@/features/workspaces/server/service-overview";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/**
 * GET — the desktop Overview page in one round trip: `WorkspaceOverview`
 * (stat-card counts, the viewer-filtered activity feed, the member-load card).
 * The histogram is `./overview-series` (switchable `metric`).
 *
 * ⚠ `viewer`+, not "any active member" (`segment.ts › ApiWorkspaceOpts`): a
 * guest 404s like a non-member. That 404 must land BEFORE the service runs —
 * every read is service-role (no RLS), so this is the only fence. "Not a
 * member", "not enough role" and "does not exist" are ONE answer.
 *
 * No degradation branch: a failed read is the page's own data — no invented zeroes.
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
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
      const workspace = await resolveApiWorkspace(workspaceSlug, userId, { apiKeyWorkspaceId });
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

      const overview = await getWorkspaceOverview(workspace.id, userId);

      // ⚠ Per-caller data (viewer-fenced activity) — never CDN-cacheable.
      return NextResponse.json(overview, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/overview", err);
    }
  }
);

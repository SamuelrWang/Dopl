import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceOverview } from "@/features/workspaces/server/service-overview";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET — the desktop Overview page in one round trip: `WorkspaceOverview`
 * (stat-card counts, the viewer-filtered activity feed, the member-load card).
 * The histogram is `./overview-series` — a separate route only because its
 * `metric` is a switchable query parameter, not a second view of this resource.
 *
 * `viewer`+ — ⚠ NOT "any active member", which is what this said until
 * 2026-08-26. `resolveApiWorkspace` proved membership EXISTENCE and never
 * compared the role, so a `guest` read workspace-wide message / session /
 * member / channel counts for the container they were invited into. The floor is
 * now the resolver's inverted default (`segment.ts › ApiWorkspaceOpts`) and a
 * guest 404s exactly as a non-member does. ⚠ That 404 must land BEFORE the
 * service runs — every read behind it is service-role and bypasses RLS, so this
 * is the only fence. Existence is not an oracle: "not a member", "not enough
 * role" and "does not exist" are ONE answer.
 *
 * No degradation branch. Unlike the retired `overview-counts` there is no
 * cosmetic side-read to swallow — a failed read here is the page's own data,
 * and the route invents no zeroes for it.
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

      const overview = await getWorkspaceOverview(workspace.id, userId);

      // ⚠ Per-caller data (activity is fenced to THIS viewer's channels) —
      // never CDN-cacheable by URL alone.
      return NextResponse.json(overview, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/overview", err);
    }
  }
);

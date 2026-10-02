import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceTokenSpend } from "@/features/workspaces/server/service-usage";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

const SOURCE = "api/workspaces/[workspaceSlug]/token-spend";

/**
 * GET — the workspace Overview's token-spend strip: how many tokens the
 * CALLER'S OWN agents have spent IN THIS CONTAINER, per run, over 31 days.
 *
 * 🔒 Two fences (container + operator); there is no workspace-wide variant and
 * must not be one — INVARIANTS §9, migration `20260927120000` §2.
 *
 * `viewer`+: `resolveApiWorkspace` 404s non-members and guests first.
 *
 * ⚠ Own route, not a `metric` on `./overview-series`: tokens are a different
 * ledger (a FLOOR) from credits (exact).
 *
 * ⚠ No realtime, no poll (INVARIANTS §7): cold read, `private, no-store`.
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
      const workspace = await resolveApiWorkspace(workspaceSlug, userId, {
        apiKeyWorkspaceId,
      });
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
      const report = await getWorkspaceTokenSpend(workspace.id, userId);
      return NextResponse.json(report, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  }
);

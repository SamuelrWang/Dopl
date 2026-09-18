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
 * 🔒 **TWO FENCES, AND THE OPERATOR ONE IS THE ONE THAT WAS RULED. There is no
 * workspace-wide variant and there must not be one** — INVARIANTS §9 carries
 * the argument, `20260927120000` §2 the refusal it rests on.
 *
 * `viewer`+ like its siblings: `resolveApiWorkspace` 404s a non-member — and a
 * `guest` — before any service-role read runs.
 *
 * ⚠ **ITS OWN ROUTE RATHER THAN A `metric` ON `./overview-series`.** Those four
 * metrics sum `credit_usage_events`; tokens are a different ledger with a
 * different accuracy story — a FLOOR (quantized, and an ended run's last stretch
 * is never pushed) against credits' exact counts, which do not share an axis
 * without a label saying so.
 *
 * ⚠ **NO REALTIME AND NO POLL** (INVARIANTS §7): a cold read, `private,
 * no-store`.
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

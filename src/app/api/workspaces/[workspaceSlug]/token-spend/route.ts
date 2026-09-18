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
 * 🔒 **TWO FENCES, AND THE OPERATOR ONE IS THE ONE THAT WAS RULED.**
 * `workspace_token_spend` is RLS-deny-all and per-OPERATOR on purpose — its
 * migration (`20260927120000` §2) refuses a member-scoped read policy in as many
 * words, because it *"would let any workspace member read how many tokens a
 * colleague's agents burned, which nobody has ruled"*. R-29(b) left that
 * standing, so this route adds the CONTAINER fence and keeps the operator one.
 * **There is no workspace-wide variant and there must not be one** — see
 * INVARIANTS §9's fence note: an aggregate over a two-member container is that
 * fence removed by subtraction.
 *
 * `viewer`+ like its siblings: `resolveApiWorkspace` 404s a non-member — and a
 * `guest` — before any service-role read runs.
 *
 * ⚠ **ITS OWN ROUTE RATHER THAN A `metric` ON `./overview-series`.** Those four
 * metrics sum `credit_usage_events`; tokens are a different ledger with a
 * different accuracy story — a FLOOR (quantized, and an ended run's last stretch
 * is never pushed) against credits' exact counts. Those do not belong on one
 * axis without a label saying so.
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

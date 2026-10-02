import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import {
  getWorkspaceOverviewSeries,
  isChannelVisibleTo,
  parseSeriesMetric,
  parseSeriesRange,
} from "@/features/workspaces/server/service-overview";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/**
 * GET `?metric=messages|mcp|threads|credits[&range=][&channelId=]` — the
 * overview histogram's `WorkspaceOverviewSeries`: zero-filled, oldest first.
 *
 * ⚠ No `range` = the fixed 31 UTC days ending today
 * (`thread-activity.tsx` depends on that window). No `24h`: bins are calendar
 * days (`types.ts › WorkspaceSeriesRange`).
 * 🔒 `credits` = this container's SEAT wallets, never a personal one
 * (`service-usage.ts › isWorkspaceSeatBurn`); the fences differ per container
 * kind, so one shared payload was refused.
 *
 * ⚠ One route, `metric` as a param (§9). Unrecognised `metric` → 400, never a
 * default series.
 *
 * `viewer`+: `resolveApiWorkspace` 404s non-members and `guest`s before any
 * service-role read — the unscoped series is workspace-wide, so a guest would
 * otherwise see volume across channels they can't open. ⚠ Params are parsed
 * AFTER resolution so a validation error can't become an existence oracle.
 *
 * 🔒 `channelId` narrows the same resource (§9) AND is a second fence: counts
 * run as service role (no RLS backstop, §2), so the id is checked against
 * `repository-overview.ts › listVisibleChannelRefs` (the one visibility
 * statement) and a miss is 404 — "cannot see" == "does not exist".
 */
export const GET = withUserAuth(
  async (request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
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

      const metric = parseSeriesMetric(request.nextUrl.searchParams.get("metric"));
      const range = parseSeriesRange(request.nextUrl.searchParams.get("range"));

      // ⚠ Visibility read only when a channel was asked for — the unscoped
      // series is a workspace-wide aggregate; don't tax the common path.
      const channelId = request.nextUrl.searchParams.get("channelId");
      if (channelId !== null) {
        if (!(await isChannelVisibleTo(workspace.id, userId, channelId))) {
          return NextResponse.json(
            {
              error: {
                code: "CHANNEL_NOT_FOUND",
                message: "Channel not found",
              },
            },
            { status: 404 }
          );
        }
      }

      const series = await getWorkspaceOverviewSeries(
        workspace.id,
        metric,
        channelId,
        new Date(),
        range
      );

      return NextResponse.json(series, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(
        "api/workspaces/[workspaceSlug]/overview-series",
        err
      );
    }
  }
);

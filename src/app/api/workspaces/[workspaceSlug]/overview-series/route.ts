import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import {
  getWorkspaceOverviewSeries,
  isChannelVisibleTo,
  parseSeriesMetric,
} from "@/features/workspaces/server/service-overview";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/**
 * GET `?metric=messages|mcp|threads[&channelId=]` — the overview histogram's
 * `WorkspaceOverviewSeries`: a fixed 31-day UTC window ending today,
 * zero-filled, oldest first.
 *
 * ⚠ ONE ROUTE, `metric` AS A QUERY PARAMETER (§9). Three endpoints would give
 * one resource three auth wrappers and three futures. An unrecognised `metric`
 * is a 400 — never a silent fall-through to a default series, which would draw
 * an answer to a question nobody asked.
 *
 * `viewer`+ like its sibling: `resolveApiWorkspace` 404s a non-member — and,
 * since 2026-08-26, a `guest` — before any service-role read runs. ⚠ Parsed
 * AFTER resolution, so a bad `metric` on someone else's workspace still answers
 * 404 — the validation error must not become an existence oracle.
 *
 * ⚠ THE GUEST FLOOR MATTERS MOST *HERE*, and the paragraph below is why. The
 * UNSCOPED series has no channel fence at all — by design, it is a
 * workspace-wide aggregate — so a `guest` was getting 31 days of message / MCP /
 * thread volume across EVERY channel in the container, including ones they are
 * not a member of. The `?channelId=` fence was written to stop exactly that
 * class of oracle and then exempted the unscoped path, which was the whole hole.
 *
 * ⚠ `channelId` NARROWS THE SAME RESOURCE — it is a view of this series, not a
 * second one (§9: two views of one resource is a query PARAMETER). Added
 * 2026-08-25 for the Info tab's activity strip, which draws a picture ABOUT ONE
 * CHANNEL and had no honest number to draw it from.
 * 🔒 **AND IT IS A SECOND FENCE, NOT A FILTER.** The counts run as SERVICE ROLE,
 * so RLS is not a backstop (§2) and workspace membership alone is not enough:
 * a member of a workspace is not thereby a reader of every PRIVATE channel in
 * it, and an unfenced count would turn this route into an activity oracle over
 * rooms the caller cannot open. The id is checked against
 * `repository-overview.ts › listVisibleChannelRefs` — the channels feature's
 * ONE visibility statement, the same one `listChannels` builds from — and a
 * miss answers **404, the same answer an unknown workspace gets**, so
 * "cannot see" and "does not exist" stay indistinguishable.
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

      // ⚠ THE VISIBILITY READ RUNS ONLY WHEN A CHANNEL WAS ASKED FOR. The
      // unscoped series is a workspace-wide aggregate and has always been one;
      // paying two extra queries on every overview load to fence a scope
      // nobody requested would be a tax on the common path.
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
        channelId
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

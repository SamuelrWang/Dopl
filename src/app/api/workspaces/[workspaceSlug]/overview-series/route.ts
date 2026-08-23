import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import {
  getWorkspaceOverviewSeries,
  parseSeriesMetric,
} from "@/features/workspaces/server/service-overview";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET `?metric=messages|mcp|threads` — the overview histogram's
 * `WorkspaceOverviewSeries`: a fixed 31-day UTC window ending today,
 * zero-filled, oldest first.
 *
 * ⚠ ONE ROUTE, `metric` AS A QUERY PARAMETER (§9). Three endpoints would give
 * one resource three auth wrappers and three futures. An unrecognised `metric`
 * is a 400 — never a silent fall-through to a default series, which would draw
 * an answer to a question nobody asked.
 *
 * Membership-scoped like its sibling: `resolveApiWorkspace` 404s a non-member
 * before any service-role read runs. ⚠ Parsed AFTER resolution, so a bad
 * `metric` on someone else's workspace still answers 404 — the validation error
 * must not become an existence oracle.
 */
export const GET = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
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

      const metric = parseSeriesMetric(request.nextUrl.searchParams.get("metric"));
      const series = await getWorkspaceOverviewSeries(workspace.id, metric);

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

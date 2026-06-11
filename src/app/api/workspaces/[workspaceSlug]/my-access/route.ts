import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { listEffectiveAccess } from "@/features/teams/server/access";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/my-access — return the caller's
 * effective access on every resource in this workspace, in one round
 * trip. Used by the sidebar to badge each KB/skill row with a read or
 * edit icon. Shape (stable since the per-member override era):
 *   {
 *     defaultLevel: "read" | "edit",
 *     overrides: { resourceType, resourceId, level }[]
 *   }
 * `overrides` now carries the caller's resolved level on teams-mode
 * resources (max across their teams). Resources they can't see at all
 * never reach the client lists, so they're simply omitted.
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
          { status: 400 },
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
          { status: 404 },
        );
      }
      const result = await listEffectiveAccess(workspace.id, userId);
      if (!result) {
        return NextResponse.json(
          {
            error: {
              code: "NOT_A_MEMBER",
              message: "Not an active member of this workspace",
            },
          },
          { status: 403 },
        );
      }
      const payload = {
        defaultLevel: result.defaultLevel,
        // level null (teams-mode resource with no grant) maps to "read",
        // NOT omission: the client treats a missing entry as the role
        // default ("edit" for members), which would flip a just-revoked
        // KB panel to editable. "read" keeps affordances locked until the
        // lists refetch and drop the resource entirely.
        overrides: result.teamsModeResources.map((r) => ({
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          level: r.level ?? ("read" as const),
        })),
      };
      // Audit A-010: this is per-user data; never let a CDN cache it
      // by URL alone. Vercel's authenticated-route default is usually
      // safe but explicit beats implicit on a privacy-adjacent payload.
      return NextResponse.json(payload, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        {
          error: { code: "INTERNAL_ERROR", message },
        },
        { status: 500 },
      );
    }
  }
);

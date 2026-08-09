import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspaceAccess } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  listEffectiveAccess,
  toMyAccessPayload,
} from "@/features/teams/server/access";

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
      // ROLE THREADED, not re-read (P0-2, §3.3). The segment resolve already
      // fetched this caller's membership to prove they may see the workspace
      // at all; passing its `role` into `listEffectiveAccess` skips the
      // identical `findMembership` that ran a second time per request.
      const resolved = await resolveApiWorkspaceAccess(workspaceSlug, userId);
      if (!resolved) {
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
      const result = await listEffectiveAccess(resolved.workspace.id, userId, {
        role: resolved.role,
      });
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
      // Audit A-010: this is per-user data; never let a CDN cache it
      // by URL alone. Vercel's authenticated-route default is usually
      // safe but explicit beats implicit on a privacy-adjacent payload.
      // The projection is shared with `POST /api/boot`, which seeds this
      // endpoint's client cache entry — they must not drift.
      return NextResponse.json(toMyAccessPayload(result), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/my-access", err);
    }
  }
);

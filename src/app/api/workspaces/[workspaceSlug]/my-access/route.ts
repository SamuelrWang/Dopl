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
 * GET /api/workspaces/[workspaceSlug]/my-access — the caller's effective access on every resource
 * in one round trip; the sidebar badges each KB/skill row from it.
 * Shape: `{ defaultLevel: "read" | "edit", overrides: { resourceType, resourceId, level }[] }`.
 * `overrides` carries the resolved level on teams-mode resources (max across their teams);
 * resources they cannot see are omitted.
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
      // ⚠ ROLE THREADED, not re-read: the segment resolve already fetched this membership, so
      // passing its `role` skips an identical `findMembership` per request.
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
      // ⚠ Per-user data — never CDN-cacheable by URL alone.
      // ⚠ The projection is shared with `POST /api/boot`, which seeds this endpoint's client
      // cache entry: they must not drift.
      return NextResponse.json(toMyAccessPayload(result), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/my-access", err);
    }
  }
);

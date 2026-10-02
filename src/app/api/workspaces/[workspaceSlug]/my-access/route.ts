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
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/my-access — the caller's effective access on every resource
 * in one round trip; the sidebar badges each KB/skill row from it.
 * Shape: `{ defaultLevel: "read" | "edit", overrides: { resourceType, resourceId, level }[] }`.
 * `overrides` carries the resolved level on teams-mode resources (max across their teams);
 * resources they cannot see are omitted.
 *
 * ⚠ `viewer`+ (`segment.ts › ApiWorkspaceOpts`): `overrides` enumerates every
 * teams-mode resource id, which a `guest` must not see; the resolver 404s them
 * before the 403 `NOT_A_MEMBER` branch.
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
          { status: 400 },
        );
      }
      // ⚠ Role threaded from the resolve — skips a duplicate `findMembership`.
      const resolved = await resolveApiWorkspaceAccess(workspaceSlug, userId, { apiKeyWorkspaceId });
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
      // ⚠ Per-user data — never CDN-cacheable. Projection shared with
      // `POST /api/boot` (seeds this cache entry); must not drift.
      return NextResponse.json(toMyAccessPayload(result), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/my-access", err);
    }
  }
);

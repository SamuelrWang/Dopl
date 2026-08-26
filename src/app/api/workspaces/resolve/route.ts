import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveWorkspaceSegmentForUser } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

export const dynamic = "force-dynamic";

/**
 * GET ?segment=… — the HTTP face of `resolveWorkspaceSegmentForUser`
 * (`features/workspaces/server/segment.ts`), which the SPA router mirrors client-side. Accepts
 * canonical `{slug}-{publicId}` and legacy slug-only URLs.
 * Returns `{ workspace, canonical, needsRedirect }`; `needsRedirect` cues the caller to rewrite
 * to `canonical`.
 * ⚠ 404 when nothing resolves — membership-scoped, so a non-member gets the same 404 as a
 * nonexistent workspace. Visibility must not be an oracle.
 * 🔒 ⚠ AND `apiKeyWorkspaceId` IS THREADED (2026-08-26): this route is a segment→workspace
 * ORACLE, so a container-locked credential must get the same 404 here that it gets everywhere
 * else in the family. The comparison itself lives once, in `resolveWorkspaceSegmentForUser`.
 */
export const GET = withUserAuth(async (request: NextRequest, { userId, apiKeyWorkspaceId }) => {
  try {
    const segment = request.nextUrl.searchParams.get("segment")?.trim();
    if (!segment) {
      return NextResponse.json(
        {
          error: {
            code: "MISSING_SEGMENT",
            message: "segment query parameter required",
          },
        },
        { status: 400 }
      );
    }

    const resolved = await resolveWorkspaceSegmentForUser(segment, userId, {
      apiKeyWorkspaceId,
    });
    if (!resolved) {
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

    return NextResponse.json(
      {
        workspace: resolved.workspace,
        canonical: resolved.canonical,
        needsRedirect: resolved.needsRedirect,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return toHttpErrorResponse("api/workspaces/resolve", err);
  }
});

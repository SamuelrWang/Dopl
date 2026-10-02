import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveWorkspaceSegmentForUser } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

export const dynamic = "force-dynamic";

/**
 * GET ?segment=… — the HTTP face of `resolveWorkspaceSegmentForUser` (`segment.ts`). Accepts
 * canonical `{slug}-{publicId}` and legacy slug-only URLs; `needsRedirect` cues a rewrite to
 * `canonical`.
 * ⚠ Non-member and nonexistent both 404 — visibility must not be an oracle.
 * 🔒 `apiKeyWorkspaceId` is threaded so a container-locked credential gets the same 404 here
 * (comparison lives in `resolveWorkspaceSegmentForUser`).
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

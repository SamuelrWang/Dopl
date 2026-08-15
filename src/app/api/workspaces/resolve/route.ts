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
 */
export const GET = withUserAuth(async (request: NextRequest, { userId }) => {
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

    const resolved = await resolveWorkspaceSegmentForUser(segment, userId);
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

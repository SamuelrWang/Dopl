import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { resolveWorkspaceSegmentForUser } from "@/features/workspaces/server/segment";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/resolve?segment=... — turn a `{workspaceSlug}` URL
 * segment into a workspace, accepting both the canonical
 * `{slug}-{publicId}` form and legacy slug-only URLs. The HTTP twin of
 * `resolvePageWorkspace` (`features/workspaces/server/segment.ts`), which
 * the SPA router needs to mirror client-side — slug-vs-publicId
 * disambiguation and the legacy-slug fallback live only in RSC today.
 *
 * Returns `{ workspace, canonical, needsRedirect }`. `needsRedirect` is
 * the caller's cue to rewrite the URL to `canonical` — the page helper
 * 301s at that point; the SPA replaces history instead.
 *
 * 404 when nothing resolves. Lookup is membership-scoped, so a
 * non-member gets the same 404 as a nonexistent workspace — visibility
 * must not be an oracle.
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
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
});

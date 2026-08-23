import { NextRequest, NextResponse } from "next/server";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getLinkPublicInfo } from "@/features/home/server/service-reads";

/**
 * GET — what the `/link/[token]` page may show BEFORE the visitor signs in.
 *
 * ⚠ DELIBERATELY UNAUTHENTICATED, and it is the ONE route on this surface that
 * is. The visitor has, by definition, no account yet — the same rationale that
 * put `/join/` and `/api/workspaces/invitations/` in
 * `shared/auth/public-routes.ts › PUBLIC_ROUTES` (which `proxy.ts` consults,
 * but does not own) — so the security property is the token's unguessability,
 * not a session. The
 * payload is narrowed to match: a display name and three booleans, never the
 * creator's email or id (`service-reads.ts › getLinkPublicInfo`).
 *
 * ⚠ The route DIRECTORY is `/api/home/link/` (singular) rather than a sibling
 * of `/api/home/links/[linkId]`. Next.js refuses two different slug names at one
 * path level, and the two are addressed differently on purpose: a creator
 * revokes by ID, a visitor claims by TOKEN. It also keeps the PUBLIC_ROUTES
 * prefix off the authenticated half of the surface.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    return NextResponse.json(await getLinkPublicInfo(token), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse("api/home/link/[token]/info", err);
  }
}

import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";

/**
 * POST /api/workspaces/ensure-default — return the caller's default
 * (oldest-owned) workspace, provisioning it if they have none. The HTTP
 * twin of the boot path `src/app/canvas/page.tsx:32` and the auth
 * callback take: `GET /api/workspaces` lists but never provisions, so a
 * brand-new SPA session had nowhere to land.
 *
 * Idempotent — `ensureDefaultWorkspace` returns the existing workspace
 * untouched and converges on the unique-violation race, so a retry after
 * a partial failure is safe.
 *
 * `segment` is the canonical `{slug}-{publicId}` the client routes on, so
 * the caller doesn't have to re-derive it from the workspace fields.
 */
export const POST = withUserAuth(async (_request, { userId }) => {
  try {
    const workspace = await ensureDefaultWorkspace(userId);
    return NextResponse.json({
      workspace,
      segment: workspaceSegment(workspace),
    });
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

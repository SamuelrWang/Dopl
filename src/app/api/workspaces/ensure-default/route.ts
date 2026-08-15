import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * POST — the caller's default (oldest-owned) workspace, provisioning it if they have none.
 * `GET /api/workspaces` lists but never provisions, so a brand-new SPA session had nowhere to land.
 * Idempotent: `ensureDefaultWorkspace` returns an existing workspace untouched and converges on
 * the unique-violation race, so a retry after a partial failure is safe.
 * `segment` is the canonical `{slug}-{publicId}` the client routes on.
 */
export const POST = withUserAuth(async (_request, { userId }) => {
  try {
    const workspace = await ensureDefaultWorkspace(userId);
    return NextResponse.json({
      workspace,
      segment: workspaceSegment(workspace),
    });
  } catch (err) {
    return toHttpErrorResponse("api/workspaces/ensure-default", err);
  }
});

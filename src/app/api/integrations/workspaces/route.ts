import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { listMyWorkspaces } from "@/features/workspaces/server/service";

/**
 * GET /api/integrations/workspaces
 *
 * Lightweight list of the caller's workspaces — id, slug, name —
 * for the /settings/integrations grants picker. Reuses the existing
 * `listMyWorkspaces` so this endpoint stays free of its own auth
 * logic; the workspaces feature owns the source of truth.
 */
export const GET = withUserAuth(
  withErrorHandler("GET /api/integrations/workspaces", async (_req, ctx) => {
    const ws = await listMyWorkspaces(ctx.userId);
    return NextResponse.json({
      workspaces: ws.map((w) => ({ id: w.id, slug: w.slug, name: w.name })),
    });
  })
);

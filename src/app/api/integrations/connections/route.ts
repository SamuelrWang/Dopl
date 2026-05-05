import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { listIntegrationsForUser } from "@/features/integrations/server/service";

/**
 * GET /api/integrations/connections
 *
 * Returns every connection the user owns — every provider, every
 * alias, with workspace grants. Powers the /settings/integrations
 * page; the agent doesn't see this surface.
 */
export const GET = withUserAuth(
  withErrorHandler("GET /api/integrations/connections", async (_req, ctx) => {
    const rows = await listIntegrationsForUser({ userId: ctx.userId });
    return NextResponse.json({
      connections: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        alias: r.alias,
        status: r.status,
        account_email: r.accountEmail,
        account_label: r.accountLabel,
        last_used_at: r.lastUsedAt,
        granted_workspace_ids: r.grantedWorkspaceIds,
      })),
    });
  })
);

import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { listIntegrationsForUser } from "@/features/integrations/server/service";
import { gravatarUrlForEmail } from "@/features/integrations/server/avatar";

/**
 * GET /api/integrations/connections
 *
 * Returns every connection the user owns — every provider, every
 * alias, with workspace grants. Powers the /settings/integrations
 * page; the agent doesn't see this surface.
 *
 * Filtering rule: `pending:%` aliases are excluded. Those rows are
 * the placeholder we persist between `connectIntegration` and the
 * OAuth callback firing — visible to the user, they show up as
 * "Awaiting authorization," which Sam wants to hide. The state in
 * the UI should be binary: connected or not connected. Pending rows
 * still exist in the DB so the callback handler can find them by
 * `composio_connection_id`; they're just invisible until they
 * finalize into a real account row.
 */
export const GET = withUserAuth(
  withErrorHandler("GET /api/integrations/connections", async (_req, ctx) => {
    const rows = await listIntegrationsForUser({ userId: ctx.userId });
    const visible = rows.filter((r) => !r.alias.startsWith("pending:"));
    return NextResponse.json({
      connections: visible.map((r) => ({
        id: r.id,
        provider: r.provider,
        alias: r.alias,
        status: r.status,
        account_email: r.accountEmail,
        account_label: r.accountLabel,
        account_avatar_url: gravatarUrlForEmail(r.accountEmail),
        last_used_at: r.lastUsedAt,
        granted_workspace_ids: r.grantedWorkspaceIds,
      })),
    });
  })
);

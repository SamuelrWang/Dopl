import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { getWorkspaceBillingStatus } from "@/features/billing/server/status-service";

/**
 * Billing status for the active workspace — the entitlements summary `useWorkspaceEntitlements`
 * renders, including the MCP credit meter. Any active member may read. Payload assembled by
 * `billing/server/status-service.ts`.
 */
export const GET = withWorkspaceAuth(
  async (_request, { workspaceId, workspaceKind, userId }) =>
    NextResponse.json(
      await getWorkspaceBillingStatus(workspaceId, { userId, workspaceKind })
    )
);

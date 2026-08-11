import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { getWorkspaceBillingStatus } from "@/features/billing/server/status-service";

/**
 * Billing status for the active workspace — the entitlements summary the
 * UI renders (consumed by `useWorkspaceEntitlements`), including the MCP
 * credit meter. Any active member may read it. The payload is assembled by
 * `billing/server/status-service.ts`; this handler is the thin boundary.
 */
export const GET = withWorkspaceAuth(async (_request, { workspaceId }) =>
  NextResponse.json(await getWorkspaceBillingStatus(workspaceId))
);

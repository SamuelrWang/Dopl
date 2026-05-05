import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import { getIntegrationStatus } from "@/features/integrations/server/service";

/**
 * GET /api/integrations/[provider]/status
 *
 * Workspace-scoped: returns "connected" only if the user has a
 * connection for this provider that's been granted to the active
 * workspace. The MCP `integration_status` tool surfaces this directly
 * to the agent — keeps cross-workspace leakage impossible by the
 * lookup itself.
 */
export const GET = withWorkspaceAuth(
  withErrorHandler(
    "GET /api/integrations/[provider]/status",
    async (_req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");

      const result = await getIntegrationStatus({
        userId: ctx.userId,
        provider: provider.data,
        workspaceId: ctx.workspaceId,
      });
      return NextResponse.json(result);
    }
  ),
  { minRole: "viewer" }
);

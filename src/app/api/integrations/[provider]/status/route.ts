import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import { getIntegrationStatus } from "@/features/integrations/server/service";

export const GET = withWorkspaceAuth(
  withErrorHandler(
    "GET /api/integrations/[provider]/status",
    async (_req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");

      const result = await getIntegrationStatus({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        provider: provider.data,
      });
      return NextResponse.json(result);
    }
  ),
  { minRole: "viewer" }
);

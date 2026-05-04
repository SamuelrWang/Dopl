import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import { disconnectIntegration } from "@/features/integrations/server/service";

export const POST = withWorkspaceAuth(
  withErrorHandler(
    "POST /api/integrations/[provider]/disconnect",
    async (_req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");

      await disconnectIntegration({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        provider: provider.data,
      });
      return NextResponse.json({ status: "disconnected" });
    }
  ),
  { minRole: "viewer" }
);

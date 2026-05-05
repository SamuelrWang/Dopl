import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import { listIntegrationActions } from "@/features/integrations/server/service";

export const GET = withWorkspaceAuth(
  withErrorHandler(
    "GET /api/integrations/[provider]/actions",
    async (_req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");
      const actions = listIntegrationActions(provider.data);
      return NextResponse.json({ actions });
    }
  ),
  { minRole: "viewer" }
);

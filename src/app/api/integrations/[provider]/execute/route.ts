import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import {
  ExecuteActionInputSchema,
  ProviderSchema,
} from "@/features/integrations/schema";
import { executeIntegrationAction } from "@/features/integrations/server/service";

export const POST = withWorkspaceAuth(
  withErrorHandler(
    "POST /api/integrations/[provider]/execute",
    async (req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");

      const input = await parseJson(req, ExecuteActionInputSchema);
      const result = await executeIntegrationAction(
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          provider: provider.data,
        },
        { action: input.action, params: input.params }
      );
      return NextResponse.json(result);
    }
  ),
  { minRole: "member" }
);

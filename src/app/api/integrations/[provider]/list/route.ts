import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import {
  ListInputSchema,
  ProviderSchema,
} from "@/features/integrations/schema";
import { listIntegrationObjects } from "@/features/integrations/server/service";

export const POST = withWorkspaceAuth(
  withErrorHandler(
    "POST /api/integrations/[provider]/list",
    async (req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");

      const input = await parseJson(req, ListInputSchema);
      const result = await listIntegrationObjects(
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          provider: provider.data,
        },
        input
      );
      return NextResponse.json({
        objects: result.objects,
        next_cursor: result.nextCursor,
      });
    }
  ),
  { minRole: "viewer" }
);

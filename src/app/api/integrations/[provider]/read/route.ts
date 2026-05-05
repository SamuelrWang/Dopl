import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import {
  ProviderSchema,
  ReadInputSchema,
} from "@/features/integrations/schema";
import { readIntegrationObject } from "@/features/integrations/server/service";

export const POST = withWorkspaceAuth(
  withErrorHandler(
    "POST /api/integrations/[provider]/read",
    async (req, ctx) => {
      const provider = ProviderSchema.safeParse(ctx.params?.provider);
      if (!provider.success) throw HttpError.badRequest("Unknown provider");

      const input = await parseJson(req, ReadInputSchema);
      const result = await readIntegrationObject(
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          provider: provider.data,
        },
        { objectId: input.object_id }
      );
      return NextResponse.json({
        provider: result.provider,
        object_id: result.objectId,
        title: result.title,
        url: result.url,
        last_modified: result.lastModified,
        body: result.body,
      });
    }
  ),
  { minRole: "viewer" }
);

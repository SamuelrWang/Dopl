import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import { connectIntegration } from "@/features/integrations/server/service";

export const POST = withWorkspaceAuth(
  withErrorHandler("POST /api/integrations/[provider]/connect", async (_req, ctx) => {
    const provider = ProviderSchema.safeParse(ctx.params?.provider);
    if (!provider.success) throw HttpError.badRequest("Unknown provider");

    const result = await connectIntegration({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      provider: provider.data,
    });

    if (result.status === "connected") {
      return NextResponse.json({ status: "connected" });
    }
    return NextResponse.json({ status: "needs_auth", auth_url: result.authUrl });
  }),
  { minRole: "viewer" }
);

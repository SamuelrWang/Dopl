import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import { connectIntegration } from "@/features/integrations/server/service";

/**
 * POST /api/integrations/[provider]/connect
 *
 * Kick off (or re-issue) an OAuth handshake for the caller. Returns
 * the broker URL the popup should open directly. User-level: no
 * workspace context required — the connection auto-grants every
 * workspace the user belongs to at finalize time.
 */
export const POST = withUserAuth(
  withErrorHandler("POST /api/integrations/[provider]/connect", async (_req, ctx) => {
    const provider = ProviderSchema.safeParse(ctx.params?.provider);
    if (!provider.success) throw HttpError.badRequest("Unknown provider");

    const result = await connectIntegration({
      userId: ctx.userId,
      provider: provider.data,
    });

    if (result.status === "connected") {
      return NextResponse.json({
        status: "connected",
        connection_id: result.connectionId,
      });
    }
    return NextResponse.json({
      status: "needs_auth",
      auth_url: result.authUrl,
      connection_id: result.connectionId,
    });
  })
);

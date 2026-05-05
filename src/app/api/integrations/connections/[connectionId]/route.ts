import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { HttpError } from "@/shared/lib/http-error";
import { disconnectIntegration } from "@/features/integrations/server/service";

/**
 * DELETE /api/integrations/connections/[connectionId]
 *
 * Disconnect one connection by id. Cascade drops its grants. Caller
 * must own the connection — service-layer check enforces this.
 */
export const DELETE = withUserAuth(
  withErrorHandler(
    "DELETE /api/integrations/connections/[connectionId]",
    async (_req, ctx) => {
      const connectionId = ctx.params?.connectionId;
      if (!connectionId) throw HttpError.badRequest("Missing connection id");
      await disconnectIntegration({
        userId: ctx.userId,
        connectionId,
      });
      return NextResponse.json({ status: "disconnected" });
    }
  )
);

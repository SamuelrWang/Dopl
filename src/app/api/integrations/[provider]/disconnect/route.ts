import { NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { ProviderSchema } from "@/features/integrations/schema";
import {
  disconnectIntegration,
  listIntegrationsForUser,
} from "@/features/integrations/server/service";

const Body = z.object({
  connection_id: z.string().uuid().optional(),
});

/**
 * POST /api/integrations/[provider]/disconnect
 *
 * Body `{ connection_id }` — disconnects exactly that connection.
 * If omitted, disconnects every connection the user has for the
 * provider (legacy MCP path that says "disconnect gmail" without
 * picking an account).
 */
export const POST = withUserAuth(
  withErrorHandler("POST /api/integrations/[provider]/disconnect", async (req, ctx) => {
    const provider = ProviderSchema.safeParse(ctx.params?.provider);
    if (!provider.success) throw HttpError.badRequest("Unknown provider");

    const body = await parseJson(req, Body).catch(() => ({}));

    if (body && "connection_id" in body && body.connection_id) {
      await disconnectIntegration({
        userId: ctx.userId,
        connectionId: body.connection_id,
      });
      return NextResponse.json({ status: "disconnected" });
    }

    // No id supplied → drop every connection for this provider.
    const conns = await listIntegrationsForUser({ userId: ctx.userId });
    const targets = conns.filter((c) => c.provider === provider.data);
    for (const c of targets) {
      await disconnectIntegration({
        userId: ctx.userId,
        connectionId: c.id,
      });
    }
    return NextResponse.json({ status: "disconnected", count: targets.length });
  })
);

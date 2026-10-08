import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { z } from "zod";
import { parseQuery } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
import { buildChannelContext, ownMessageLanded } from "@/features/channels/server/service";

/** The write schema's own bounds (`ChannelMessageCreateSchema.clientMsgId`). */
const LandedQuerySchema = z.object({ clientMsgId: z.string().min(1).max(200) });

/**
 * GET `?clientMsgId=…` → `{ landed }`: whether the CALLER's own message with that idempotency key
 * is stored in this channel. Read-only and author-scoped; the composer uses it to settle a draft
 * whose send a reload interrupted (`src/shared/lib/draft-store.ts`).
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const { clientMsgId } = parseQuery(request.nextUrl.searchParams, LandedQuerySchema, [
      "clientMsgId",
    ]);
    const ctx = buildChannelContext(auth);
    const landed = await ownMessageLanded(ctx, requireChannelId(auth.params), clientMsgId);
    return NextResponse.json({ landed });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });

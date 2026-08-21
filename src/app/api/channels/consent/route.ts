import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson, parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createConsentRequest,
  listConsentRequests,
} from "@/features/channels/server/service";
import {
  ConsentCreateSchema,
  ConsentListQuerySchema,
} from "@/features/channels/schema";

// Per-machine consent surface (the operator's own): a workspace viewer who is a channel member
// still receives/decides requests, so the floor is viewer. The service enforces operator-only +
// channel membership.
// Neither verb is `sessionOnly` (unlike PATCH /consent/[id]): GET is a read and POST only RAISES
// a prompt — it decides nothing, and the desktop calls it on every trigger.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const query = parseQuery(request.nextUrl.searchParams, ConsentListQuerySchema, [
      "channelId",
      "status",
    ]);
    const ctx = buildChannelContext(auth);
    const requests = await listConsentRequests(ctx, {
      channelId: query.channelId,
      status: query.status,
    });
    return NextResponse.json({ requests });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ConsentCreateSchema);
    const ctx = buildChannelContext(auth);
    const consentRequest = await createConsentRequest(ctx, input);
    return NextResponse.json({ request: consentRequest }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);

import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
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

// The consent surface is per-machine (the operator's own): a workspace viewer
// who is a channel member still receives / decides requests, so the floor is
// viewer. The service enforces operator-only + channel membership.
//
// Neither verb here is `sessionOnly` (unlike PATCH /consent/[id]): GET is a
// read, and POST only RAISES a prompt for the human — it decides nothing, and
// the desktop legitimately calls it on every trigger. The decisive verbs are
// the ones that are gated.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const parsed = ConsentListQuerySchema.safeParse({
      channelId: request.nextUrl.searchParams.get("channelId") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "Invalid query", parsed.error.issues);
    }
    const ctx = buildChannelContext(auth);
    const requests = await listConsentRequests(ctx, {
      channelId: parsed.data.channelId,
      status: parsed.data.status,
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

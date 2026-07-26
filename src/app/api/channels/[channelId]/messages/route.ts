import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  postMessage,
  readMessages,
} from "@/features/channels/server/service";
import {
  ChannelMessageCreateSchema,
  MessageReadQuerySchema,
} from "@/features/channels/schema";

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const params = request.nextUrl.searchParams;
    const parsed = MessageReadQuerySchema.safeParse({
      since: params.get("since") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "Invalid query", parsed.error.issues);
    }
    const ctx = buildChannelContext(auth);
    const messages = await readMessages(ctx, requireChannelId(auth.params), parsed.data);
    return NextResponse.json({ messages });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMessageCreateSchema);
    const ctx = buildChannelContext(auth);
    const message = await postMessage(ctx, requireChannelId(auth.params), input);
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

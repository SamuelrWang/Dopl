import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createChannel,
  listChannels,
} from "@/features/channels/server/service";
import { ChannelCreateSchema } from "@/features/channels/schema";

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const includeArchived =
      request.nextUrl.searchParams.get("include") === "archived";
    const channels = await listChannels(ctx, includeArchived);
    return NextResponse.json({ channels });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelCreateSchema);
    const ctx = buildChannelContext(auth);
    const channel = await createChannel(ctx, input);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

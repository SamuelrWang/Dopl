import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  deleteChannel,
  getChannel,
  updateChannel,
} from "@/features/channels/server/service";
import { ChannelUpdateSchema } from "@/features/channels/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const channel = await getChannel(ctx, requireChannelId(auth.params));
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const patch = await parseJson(request, ChannelUpdateSchema);
    const ctx = buildChannelContext(auth);
    const channel = await updateChannel(ctx, requireChannelId(auth.params), patch);
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    await deleteChannel(ctx, requireChannelId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

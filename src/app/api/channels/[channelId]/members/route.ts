import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  addMember,
  buildChannelContext,
  listChannelMembers,
  removeMember,
} from "@/features/channels/server/service";
import {
  ChannelMemberAddSchema,
  ChannelMemberRemoveSchema,
} from "@/features/channels/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const members = await listChannelMembers(ctx, requireChannelId(auth.params));
    return NextResponse.json({ members });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMemberAddSchema);
    const ctx = buildChannelContext(auth);
    const member = await addMember(ctx, requireChannelId(auth.params), input.userId);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMemberRemoveSchema);
    const ctx = buildChannelContext(auth);
    await removeMember(ctx, requireChannelId(auth.params), input.userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

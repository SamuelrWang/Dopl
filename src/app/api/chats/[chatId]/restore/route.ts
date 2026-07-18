import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { requireChatId, toChatErrorResponse } from "@/shared/api/chat-route";
import { buildChatContext, restoreChat } from "@/features/chats/server/service";

async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    const chat = await restoreChat(ctx, requireChatId(auth.params));
    return NextResponse.json({ chat });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

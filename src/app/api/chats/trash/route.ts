import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toChatErrorResponse } from "@/shared/api/chat-route";
import { buildChatContext, listTrash } from "@/features/chats/server/service";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    const chats = await listTrash(ctx);
    return NextResponse.json({ chats });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

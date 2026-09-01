import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChatErrorResponse } from "@/shared/api/chat-route";
import {
  buildChatContext,
  exportChat,
  listChats,
} from "@/features/chats/server/service";
import { ChatExportSchema } from "@/features/chats/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    const { chats, hiddenCount, truncated } = await listChats(ctx);
    return NextResponse.json({ chats, hiddenCount, truncated });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChatExportSchema);
    const ctx = buildChatContext(auth);
    const chat = await exportChat(ctx, input);
    return NextResponse.json({ chat }, { status: 201 });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

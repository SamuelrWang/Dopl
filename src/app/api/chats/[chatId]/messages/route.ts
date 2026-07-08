import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChatId, toChatErrorResponse } from "@/shared/api/chat-route";
import {
  appendMessages,
  buildChatContext,
} from "@/features/chats/server/service";
import { ChatAppendSchema } from "@/features/chats/schema";

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChatAppendSchema);
    const ctx = buildChatContext(auth);
    const chat = await appendMessages(ctx, requireChatId(auth.params), input);
    return NextResponse.json({ chat }, { status: 201 });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

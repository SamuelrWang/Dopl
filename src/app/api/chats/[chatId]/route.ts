import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChatId, toChatErrorResponse } from "@/shared/api/chat-route";
import {
  buildChatContext,
  deleteChat,
  getChat,
  updateChatHeader,
} from "@/features/chats/server/service";
import { ChatUpdateSchema } from "@/features/chats/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    const chat = await getChat(ctx, requireChatId(auth.params));
    return NextResponse.json({ chat });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const patch = await parseJson(request, ChatUpdateSchema);
    const ctx = buildChatContext(auth);
    const chat = await updateChatHeader(ctx, requireChatId(auth.params), patch);
    return NextResponse.json({ chat });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    await deleteChat(ctx, requireChatId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

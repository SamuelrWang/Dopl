import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChatErrorResponse } from "@/shared/api/chat-route";
import {
  buildChatContext,
  createFolder,
  listFolders,
} from "@/features/chats/server/service";
import { ChatFolderCreateSchema } from "@/features/chats/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    const folders = await listFolders(ctx);
    return NextResponse.json({ folders });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChatFolderCreateSchema);
    const ctx = buildChatContext(auth);
    const folder = await createFolder(ctx, input.name);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireFolderId, toChatErrorResponse } from "@/shared/api/chat-route";
import {
  buildChatContext,
  deleteFolderForUser,
  renameFolderForUser,
} from "@/features/chats/server/service";
import { ChatFolderRenameSchema } from "@/features/chats/schema";

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChatFolderRenameSchema);
    const ctx = buildChatContext(auth);
    const folder = await renameFolderForUser(
      ctx,
      requireFolderId(auth.params),
      input.name
    );
    return NextResponse.json({ folder });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    await deleteFolderForUser(ctx, requireFolderId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChatErrorResponse(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

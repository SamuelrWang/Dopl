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
  updateFolderForUser,
} from "@/features/chats/server/service";
import { ChatFolderUpdateSchema } from "@/features/chats/schema";

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChatFolderUpdateSchema);
    const ctx = buildChatContext(auth);
    const folder = await updateFolderForUser(
      ctx,
      requireFolderId(auth.params),
      input
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
// 🔒 `sessionOnly` (2026-09-02). `dopl_chats_admin` op="delete_folder" advertises this deletion as
// APP-ONLY — "there is no MCP path to it, for any role or token" — and
// `packages/mcp-server/src/gating.ts › opRefusal` was the ONLY thing enforcing
// that sentence. A `full`-profile session has Bash and its own `dopl_at_*`
// bearer, so it reached THIS route over loopback and deleted the row the
// refusal had just declined: a prompt is not a fence. ⚠ Per-METHOD — the reads
// and the PATCH stay ungated, because editing and rewriting are exactly what
// `delete-policy.ts › DELETE_REFUSAL` redirects an agent to instead.
// Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});

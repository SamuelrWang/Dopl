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
import { ChatOutsideRetentionError } from "@/features/chats/server/errors";
import { chatRetentionDeniedBody } from "@/features/chats/server/retention";
import { ChatUpdateSchema } from "@/features/chats/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChatContext(auth);
    const chat = await getChat(ctx, requireChatId(auth.params));
    return NextResponse.json({ chat });
  } catch (err) {
    // Hidden by the free-plan retention window: return the flat upgrade envelope (mirroring
    // billing's denial body), not the generic chat error envelope.
    if (err instanceof ChatOutsideRetentionError) {
      return NextResponse.json(chatRetentionDeniedBody(), {
        status: 403,
      });
    }
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
// 🔒 `sessionOnly` (2026-09-02). `dopl_chats_admin` op="delete" advertises this deletion as
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

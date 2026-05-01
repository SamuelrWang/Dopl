import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  listTrash,
} from "@/features/knowledge/server/service";

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = request.nextUrl.searchParams.get("baseId") ?? undefined;
    const ctx = buildKnowledgeContext(auth);
    const trash = await listTrash(ctx, baseId);
    return NextResponse.json(trash);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

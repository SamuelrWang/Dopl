import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  moveFolder,
} from "@/features/knowledge/server/service";
import { KnowledgeFolderMoveSchema } from "@/features/knowledge/schema";

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.folderId;
    if (!id) throw HttpError.badRequest("folderId is required");
    const input = await parseJson(request, KnowledgeFolderMoveSchema);
    const ctx = buildKnowledgeContext(auth);
    const folder = await moveFolder(ctx, id, input);
    return NextResponse.json({ folder });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

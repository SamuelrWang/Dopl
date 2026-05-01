import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  restoreFolder,
} from "@/features/knowledge/server/service";

async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.folderId;
    if (!id) throw HttpError.badRequest("folderId is required");
    const ctx = buildKnowledgeContext(auth);
    const folder = await restoreFolder(ctx, id);
    return NextResponse.json({ folder });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

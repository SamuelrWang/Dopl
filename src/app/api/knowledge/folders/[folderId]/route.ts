import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  deleteFolder,
  updateFolder,
} from "@/features/knowledge/server/service";
import { KnowledgeFolderUpdateSchema } from "@/features/knowledge/schema";

function requireFolderId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.folderId;
  if (!id) throw HttpError.badRequest("folderId is required");
  return id;
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireFolderId(auth);
    const patch = await parseJson(request, KnowledgeFolderUpdateSchema);
    // Optional `X-Updated-At` precondition.
    const expectedUpdatedAt =
      request.headers.get("x-updated-at") ?? undefined;
    const ctx = buildKnowledgeContext(auth);
    const folder = await updateFolder(ctx, id, patch, expectedUpdatedAt);
    return NextResponse.json({ folder });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireFolderId(auth);
    const ctx = buildKnowledgeContext(auth);
    await deleteFolder(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

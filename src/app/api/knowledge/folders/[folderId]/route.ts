import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  softDeleteFolder,
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
    // Optional `X-Updated-At` precondition (Item 5.A.3).
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
    await softDeleteFolder(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

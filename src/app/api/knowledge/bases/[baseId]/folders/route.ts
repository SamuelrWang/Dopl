import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createFolder,
  listFolders,
} from "@/features/knowledge/server/service";
import { KnowledgeFolderCreateSchema } from "@/features/knowledge/schema";

// URL provides the parent base, so the body must NOT carry it. Omitting
// the field at parse time means clients can `POST {name: "..."}` without
// a redundant `knowledgeBaseId` field — and prevents silent override of
// a mismatched value (we'd inject the URL's id either way).
const FolderCreateBodySchema = KnowledgeFolderCreateSchema.omit({
  knowledgeBaseId: true,
});

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const folders = await listFolders(ctx, requireBaseId(auth));
    return NextResponse.json({ folders });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const body = await parseJson(request, FolderCreateBodySchema);
    const ctx = buildKnowledgeContext(auth);
    const folder = await createFolder(ctx, { ...body, knowledgeBaseId: baseId });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

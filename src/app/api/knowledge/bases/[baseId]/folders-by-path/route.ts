import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createFolderByPath,
  deleteByPath,
  listDirByPath,
} from "@/features/knowledge/server/service";

/**
 * Path-based folder operations:
 *   - POST { path }      → mkdir -p; idempotent
 *   - GET  ?path=…       → list immediate children of folder at path
 *   - DELETE ?path=…     → soft-delete folder OR entry at path (whichever the path resolves to)
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

const CreateFolderSchema = z.object({
  path: z.string().min(1),
});

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const path = request.nextUrl.searchParams.get("path") ?? "";
    const ctx = buildKnowledgeContext(auth);
    const listing = await listDirByPath(ctx, baseId, path);
    return NextResponse.json(listing);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const input = await parseJson(request, CreateFolderSchema);
    const ctx = buildKnowledgeContext(auth);
    const folder = await createFolderByPath(ctx, baseId, input.path);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const path = request.nextUrl.searchParams.get("path");
    if (path === null) {
      throw HttpError.badRequest("path query parameter is required");
    }
    const ctx = buildKnowledgeContext(auth);
    const result = await deleteByPath(ctx, baseId, path);
    return NextResponse.json(result);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getBaseById,
  softDeleteBase,
  updateBase,
} from "@/features/knowledge/server/service";
import { KnowledgeBaseUpdateSchema } from "@/features/knowledge/schema";

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const base = await getBaseById(ctx, requireBaseId(auth));
    return NextResponse.json({ base });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireBaseId(auth);
    const patch = await parseJson(request, KnowledgeBaseUpdateSchema);
    const ctx = buildKnowledgeContext(auth);
    const base = await updateBase(ctx, id, patch);
    return NextResponse.json({ base });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireBaseId(auth);
    const ctx = buildKnowledgeContext(auth);
    await softDeleteBase(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

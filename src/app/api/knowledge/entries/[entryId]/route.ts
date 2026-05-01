import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getEntry,
  softDeleteEntry,
  updateEntry,
} from "@/features/knowledge/server/service";
import { KnowledgeEntryUpdateSchema } from "@/features/knowledge/schema";

function requireEntryId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.entryId;
  if (!id) throw HttpError.badRequest("entryId is required");
  return id;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const entry = await getEntry(ctx, requireEntryId(auth));
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireEntryId(auth);
    const patch = await parseJson(request, KnowledgeEntryUpdateSchema);
    // Optional `X-Updated-At` precondition — clients pass the entry's
    // current `updatedAt` to enable optimistic-concurrency rejection.
    // Mismatch → 412 KNOWLEDGE_STALE_VERSION (Item 5.A.3).
    const expectedUpdatedAt =
      request.headers.get("x-updated-at") ?? undefined;
    const ctx = buildKnowledgeContext(auth);
    const entry = await updateEntry(ctx, id, patch, expectedUpdatedAt);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireEntryId(auth);
    const ctx = buildKnowledgeContext(auth);
    await softDeleteEntry(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

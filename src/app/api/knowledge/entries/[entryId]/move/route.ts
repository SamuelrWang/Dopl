import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  moveEntry,
} from "@/features/knowledge/server/service";
import { KnowledgeEntryMoveSchema } from "@/features/knowledge/schema";

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.entryId;
    if (!id) throw HttpError.badRequest("entryId is required");
    const input = await parseJson(request, KnowledgeEntryMoveSchema);
    const ctx = buildKnowledgeContext(auth);
    const entry = await moveEntry(ctx, id, input);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

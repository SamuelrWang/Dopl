import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  restoreBase,
} from "@/features/knowledge/server/service";

async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.baseId;
    if (!id) throw HttpError.badRequest("baseId is required");
    const ctx = buildKnowledgeContext(auth);
    const base = await restoreBase(ctx, id);
    return NextResponse.json({ base });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

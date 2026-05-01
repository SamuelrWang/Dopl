import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getBaseTree,
} from "@/features/knowledge/server/service";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.baseId;
    if (!id) throw HttpError.badRequest("baseId is required");
    const ctx = buildKnowledgeContext(auth);
    const tree = await getBaseTree(ctx, id);
    return NextResponse.json(tree);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

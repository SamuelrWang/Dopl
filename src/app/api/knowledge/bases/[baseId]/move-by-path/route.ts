import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  moveByPath,
} from "@/features/knowledge/server/service";

/** Path-based move + rename (`kb_move_file` / `kb_move_folder`). `toPath`'s parents are
 *  mkdir-p'd and its leaf becomes the new name. Atomic: rename + reparent in one repo update. */

const MoveSchema = z.object({
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
});

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = auth.params?.baseId;
    if (!baseId) throw HttpError.badRequest("baseId is required");
    const input = await parseJson(request, MoveSchema);
    const ctx = buildKnowledgeContext(auth);
    const result = await moveByPath(ctx, baseId, input.fromPath, input.toPath);
    return NextResponse.json(result);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

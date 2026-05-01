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

/**
 * Path-based move + rename. Used by `kb_move_file` / `kb_move_folder`.
 *
 * `fromPath` resolves to the source folder or entry. `toPath`'s parent
 * folders are mkdir-p'd. The leaf segment of `toPath` becomes the new
 * name. Atomic — both rename and reparent in a single repo update.
 */

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

export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

import { NextRequest } from "next/server";
import { resolveExportWorkspace } from "@/shared/auth/export-workspace";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  knowledgeDownloadResponse,
  toKnowledgeErrorResponse,
} from "@/shared/api/knowledge-route";
import { buildKnowledgeContext } from "@/features/knowledge/server/service";
import { buildEntryFile } from "@/features/knowledge/server/export";

// A plain download link can't send X-Workspace-Id, so `?workspaceId=` scopes
// the export to a non-default workspace (membership-checked in the helper).
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.entryId;
    if (!id) throw HttpError.badRequest("entryId is required");
    const { workspaceId, role } = await resolveExportWorkspace(request, auth);
    const ctx = buildKnowledgeContext({ ...auth, workspaceId, role });
    const { filename, content } = await buildEntryFile(ctx, id);
    return knowledgeDownloadResponse(filename, content, "text/markdown; charset=utf-8");
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

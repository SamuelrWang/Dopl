import { NextRequest } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  knowledgeDownloadResponse,
  toKnowledgeErrorResponse,
} from "@/shared/api/knowledge-route";
import { buildKnowledgeContext } from "@/features/knowledge/server/service";
import { buildBaseArchive } from "@/features/knowledge/server/export";

// A plain download link can't send X-Workspace-Id, so `workspaceIdFromQuery`
// lets the wrapper resolve `?workspaceId=` at the header's priority
// (membership-checked) — `auth` already names the effective export workspace.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.baseId;
    if (!id) throw HttpError.badRequest("baseId is required");
    const ctx = buildKnowledgeContext(auth);
    const { filename, data } = await buildBaseArchive(ctx, id);
    return knowledgeDownloadResponse(filename, data, "application/zip");
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet, { workspaceIdFromQuery: true });

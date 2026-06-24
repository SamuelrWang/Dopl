import { NextRequest } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  knowledgeDownloadResponse,
  toKnowledgeErrorResponse,
} from "@/shared/api/knowledge-route";
import { buildKnowledgeContext } from "@/features/knowledge/server/service";
import { buildFolderArchive } from "@/features/knowledge/server/export";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.folderId;
    if (!id) throw HttpError.badRequest("folderId is required");
    const ctx = buildKnowledgeContext(auth);
    const { filename, data } = await buildFolderArchive(ctx, id);
    return knowledgeDownloadResponse(filename, data, "application/zip");
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

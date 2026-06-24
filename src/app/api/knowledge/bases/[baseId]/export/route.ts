import { NextRequest } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  knowledgeDownloadResponse,
  toKnowledgeErrorResponse,
} from "@/shared/api/knowledge-route";
import { buildKnowledgeContext } from "@/features/knowledge/server/service";
import { buildBaseArchive } from "@/features/knowledge/server/export";

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

export const GET = withWorkspaceAuth(handleGet);

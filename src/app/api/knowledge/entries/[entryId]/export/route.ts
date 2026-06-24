import { NextRequest } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  knowledgeDownloadResponse,
  toKnowledgeErrorResponse,
} from "@/shared/api/knowledge-route";
import { buildKnowledgeContext } from "@/features/knowledge/server/service";
import { buildEntryFile } from "@/features/knowledge/server/export";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.entryId;
    if (!id) throw HttpError.badRequest("entryId is required");
    const ctx = buildKnowledgeContext(auth);
    const { filename, content } = await buildEntryFile(ctx, id);
    return knowledgeDownloadResponse(filename, content, "text/markdown; charset=utf-8");
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

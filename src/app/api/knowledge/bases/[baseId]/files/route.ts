import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  readFileByPath,
  writeFileByPath,
} from "@/features/knowledge/server/service";

/**
 * Path-based file CRUD. Used by MCP tools (`kb_read_file`, `kb_write_file`)
 * and the CLI. ID-based equivalents live under `/api/knowledge/entries/...`.
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

function requirePathParam(request: NextRequest): string {
  const path = request.nextUrl.searchParams.get("path");
  if (path === null) {
    throw HttpError.badRequest("path query parameter is required");
  }
  return path;
}

const WriteFileSchema = z.object({
  path: z.string(),
  body: z.string().optional(),
  title: z.string().min(1).max(300).optional(),
});

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const path = requirePathParam(request);
    const ctx = buildKnowledgeContext(auth);
    const entry = await readFileByPath(ctx, baseId, path);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const input = await parseJson(request, WriteFileSchema);
    const ctx = buildKnowledgeContext(auth);
    const entry = await writeFileByPath(ctx, baseId, input.path, {
      body: input.body,
      title: input.title,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PUT = withWorkspaceAuth(handlePut, { minRole: "editor" });

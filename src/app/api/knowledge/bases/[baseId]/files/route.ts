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
import {
  NAME_RE,
  NAME_INVALID_MESSAGE,
} from "@/features/knowledge/schema";

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

// `title` constraints + 1 MB body cap mirror KnowledgeEntryUpdateSchema
// in features/knowledge/schema.ts. NAME_RE / NAME_INVALID_MESSAGE are
// imported from the schema module so the literal lives in exactly one
// place (audit cohesion fix F-2).
const MAX_BODY_BYTES = 1_048_576;
const WriteFileSchema = z.object({
  path: z.string(),
  body: z.string().max(MAX_BODY_BYTES, "Body must be 1 MB or less").optional(),
  title: z.string().min(1).max(300).regex(NAME_RE, NAME_INVALID_MESSAGE).optional(),
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { DESCRIPTION_MAX } from "@/config";
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

/** Path-based file CRUD for `kb_read_file` / `kb_write_file` + the CLI.
 *  ID-based equivalents live under `/api/knowledge/entries/...`. */

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

// ⚠ `title` constraints + the 1 MB body cap MIRROR KnowledgeEntryUpdateSchema in
// features/knowledge/schema.ts — keep in sync. NAME_RE / NAME_INVALID_MESSAGE are imported from
// that module so the literal lives in exactly one place.
const MAX_BODY_BYTES = 1_048_576;
const WriteFileSchema = z.object({
  path: z.string(),
  body: z.string().max(MAX_BODY_BYTES, "Body must be 1 MB or less").optional(),
  title: z.string().min(1).max(300).regex(NAME_RE, NAME_INVALID_MESSAGE).optional(),
  // Agent-facing summary (≤300 chars) shown in get_tree / list_dir. `null` clears; omit keeps.
  excerpt: z.string().max(DESCRIPTION_MAX).nullable().optional(),
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
    // Precondition on the resolved entry's updated_at. Mismatch → 412 KNOWLEDGE_STALE_VERSION.
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const { entry } = await writeFileByPath(ctx, baseId, input.path, {
      body: input.body,
      title: input.title,
      excerpt: input.excerpt,
      expectedUpdatedAt,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });

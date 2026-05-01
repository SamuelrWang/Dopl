import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createEntry,
  listEntries,
  type ListEntriesOpts,
} from "@/features/knowledge/server/service";
import { KnowledgeEntryCreateSchema } from "@/features/knowledge/schema";

// URL provides the parent base — drop the body's redundant field.
const EntryCreateBodySchema = KnowledgeEntryCreateSchema.omit({
  knowledgeBaseId: true,
});

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

const FolderIdSchema = z.string().uuid();

/**
 * Parses `?folderId=` and `?includeBody=` query params.
 *   - folderId not present  → don't filter by folder.
 *   - folderId=null (literal) → root entries only (folder_id IS NULL).
 *   - folderId=<uuid>       → that folder.
 *   - includeBody=false     → strip body for tree/list views.
 *
 * Throws `HttpError.badRequest` if `folderId` is neither "null" nor a
 * valid UUID — without this guard a non-UUID value gets forwarded to
 * Postgres and surfaces as a 500.
 */
function parseListOpts(url: URL): ListEntriesOpts {
  const opts: ListEntriesOpts = {};
  const raw = url.searchParams.get("folderId");
  if (raw !== null) {
    if (raw === "null") {
      opts.folderId = null;
    } else {
      const parsed = FolderIdSchema.safeParse(raw);
      if (!parsed.success) {
        throw HttpError.badRequest(
          `folderId must be a UUID or the literal string "null"`
        );
      }
      opts.folderId = parsed.data;
    }
  }
  if (url.searchParams.get("includeBody") === "false") {
    opts.includeBody = false;
  }
  return opts;
}

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const opts = parseListOpts(request.nextUrl);
    const entries = await listEntries(ctx, requireBaseId(auth), opts);
    return NextResponse.json({ entries });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const body = await parseJson(request, EntryCreateBodySchema);
    const ctx = buildKnowledgeContext(auth);
    const entry = await createEntry(ctx, { ...body, knowledgeBaseId: baseId });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

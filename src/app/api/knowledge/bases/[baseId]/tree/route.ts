import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getBaseTree,
} from "@/features/knowledge/server/service";

const MAX_ENTRY_LIMIT = 1000;

/**
 * Optional entry paging: `?entryLimit=` turns it on (folders always ship
 * in full); `?entryCursor=` is the opaque cursor from a prior page's
 * `nextEntryCursor`. Absent params = the legacy full snapshot.
 */
function parseTreeOpts(
  url: URL
): { entryLimit: number; entryOffset: number } | undefined {
  const rawLimit = url.searchParams.get("entryLimit");
  if (rawLimit === null) return undefined;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw HttpError.badRequest("entryLimit must be a positive integer");
  }
  const rawCursor = url.searchParams.get("entryCursor");
  const offset = rawCursor === null ? 0 : Number(rawCursor);
  if (!Number.isInteger(offset) || offset < 0) {
    throw HttpError.badRequest("entryCursor is not a cursor from this endpoint");
  }
  return { entryLimit: Math.min(limit, MAX_ENTRY_LIMIT), entryOffset: offset };
}

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.baseId;
    if (!id) throw HttpError.badRequest("baseId is required");
    const ctx = buildKnowledgeContext(auth);
    const tree = await getBaseTree(ctx, id, parseTreeOpts(request.nextUrl));
    return NextResponse.json(tree);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

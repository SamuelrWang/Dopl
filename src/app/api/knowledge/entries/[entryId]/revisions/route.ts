import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  listEntryRevisions,
} from "@/features/knowledge/server/service";
import { parseQuery } from "@/shared/api/parse-json";
import {
  REVISION_QUERY_KEYS,
  RevisionQuerySchema,
} from "@/features/revisions/schema";

/**
 * `GET /api/knowledge/entries/{entryId}/revisions` — ONE entry's changelog,
 * newest first, paged by an opaque keyset cursor.
 *
 * ⚠ **THE DAY GROUPING IS THE CLIENT'S, NOT THIS ROUTE'S.** The service exports
 * `groupByDay` as a pure helper and both surfaces call it on the rows they hold,
 * so a page boundary never falls INSIDE a day group on the wire and the renderer
 * can merge two pages into one list of days. A server-grouped payload would have
 * to re-open the last group on every subsequent page.
 *
 * 🔒 GATED IN THE SERVICE on `readEntry` — the id-following read the sibling
 * `GET /api/knowledge/entries/{entryId}` uses. Viewer floor, like that route.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const entryId = auth.params?.entryId;
    if (!entryId) throw HttpError.badRequest("entryId is required");
    const query = parseQuery(
      request.nextUrl.searchParams,
      RevisionQuerySchema,
      REVISION_QUERY_KEYS
    );
    const ctx = buildKnowledgeContext(auth);
    const page = await listEntryRevisions(ctx, entryId, query);
    return NextResponse.json(page);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

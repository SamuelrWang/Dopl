import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  listBaseRevisions,
} from "@/features/knowledge/server/service";
import { parseQuery } from "@/shared/api/parse-json";
import {
  REVISION_QUERY_KEYS,
  RevisionQuerySchema,
} from "@/features/revisions/schema";

/**
 * `GET /api/knowledge/bases/{baseId}/revisions` — the BASE ROLL-UP: every
 * revision of the base and of everything in it, newest first.
 *
 * ⚠ **IT IS A SECOND ROUTE RATHER THAN A `?view=` ON THE ENTRY ONE, BECAUSE IT
 * IS A DIFFERENT RESOURCE** (INVARIANTS §9's rule is about two VIEWS of ONE
 * resource). A base and an entry are addressed by different ids and gated by
 * different reads; folding them would give one handler two auth paths.
 *
 * ⚠ **AND IT IS NOT FOLDED INTO `GET .../tree`.** The tree is the navigation
 * payload every knowledge surface loads on open; history is asked for only when
 * somebody opens the Changelog section, and putting it on the tree would make
 * every base open pay for it.
 *
 * 🔒 GATED IN THE SERVICE on `readBaseInContext`, then narrowed to the ids that
 * base owns. Viewer floor, like `GET /api/knowledge/bases/{baseId}/tree`.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = auth.params?.baseId;
    if (!baseId) throw HttpError.badRequest("baseId is required");
    const query = parseQuery(
      request.nextUrl.searchParams,
      RevisionQuerySchema,
      REVISION_QUERY_KEYS
    );
    const ctx = buildKnowledgeContext(auth);
    const page = await listBaseRevisions(ctx, baseId, query);
    return NextResponse.json(page);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

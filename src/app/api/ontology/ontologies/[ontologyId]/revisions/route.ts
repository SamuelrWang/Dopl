import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { mapRevisionError } from "@/features/revisions/server/http-mapping";
import { parseQuery } from "@/shared/api/parse-json";
import {
  REVISION_QUERY_KEYS,
  RevisionQuerySchema,
} from "@/features/revisions/schema";
import { buildOntologyContext } from "@/features/ontology/server/service";
import { listOntologyRevisions } from "@/features/ontology/server/service-revisions-read";

/**
 * `GET /api/ontology/ontologies/{ontologyId}/revisions` — THE ONTOLOGY ROLL-UP:
 * every revision of the ontology and of every object in it, newest first.
 *
 * ⚠ **A SECOND ROUTE RATHER THAN A `?view=` ON THE OBJECT ONE, BECAUSE IT IS A
 * DIFFERENT RESOURCE** (INVARIANTS §9's rule is about two VIEWS of ONE
 * resource): an ontology and an object are addressed by different ids and gated by
 * different reads, so folding them would give one handler two auth paths.
 *
 * ⚠ **AND IT IS NOT FOLDED INTO `GET /api/ontology`.** That snapshot is what
 * every board and every /home card loads on open; history is asked for only when
 * somebody opens the Changelog, and putting it on the snapshot would make every
 * board open pay for it.
 *
 * 🔒 GATED IN THE SERVICE at `view`, then narrowed to the ids the ontology's own
 * membership walk produces. `minRole: "guest"` — the floor `GET /api/ontology`
 * carries.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ontologyId = auth.params?.ontologyId;
    if (!ontologyId) throw HttpError.badRequest("Missing ontologyId");
    const query = parseQuery(
      request.nextUrl.searchParams,
      RevisionQuerySchema,
      REVISION_QUERY_KEYS
    );
    const page = await listOntologyRevisions(buildOntologyContext(auth), ontologyId, query);
    return NextResponse.json(page);
  } catch (err) {
    return toHttpErrorResponse("ontology", err, mapRevisionError);
  }
}

export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });

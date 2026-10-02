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
 * ⚠ A separate route, not a `?view=` on the object one: a different resource
 * with a different gate (INVARIANTS §9). Not folded into `GET /api/ontology`
 * either — every board open would pay for history.
 *
 * 🔒 Gated in the service at `view`, narrowed to the ontology's membership walk.
 * `minRole: "guest"` like `GET /api/ontology`.
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

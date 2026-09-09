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
import { listObjectRevisions } from "@/features/ontology/server/service-revisions-read";

/**
 * `GET /api/ontology/objects/{objectId}/revisions` — ONE object's per-FIELD
 * history, newest first, paged by an opaque keyset cursor.
 *
 * ⚠ **THE DAY GROUPING IS THE CLIENT'S, NOT THIS ROUTE'S** — the same rule the
 * knowledge changelog routes state: a page boundary must never fall inside a day
 * group on the wire, or the renderer heads one calendar day twice.
 *
 * 🔒 GATED IN THE SERVICE at `view` (Q9's read half), and `minRole: "guest"` —
 * the SAME floor `PATCH /api/ontology/objects/{objectId}` carries since the
 * home-ontology ruling. ⚠ The floor is the weakest fence here, not the gate: a
 * guest with no share gets `requireObject`'s 404.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const objectId = auth.params?.objectId;
    if (!objectId) throw HttpError.badRequest("Missing objectId");
    const query = parseQuery(
      request.nextUrl.searchParams,
      RevisionQuerySchema,
      REVISION_QUERY_KEYS
    );
    const page = await listObjectRevisions(buildOntologyContext(auth), objectId, query);
    return NextResponse.json(page);
  } catch (err) {
    return toHttpErrorResponse("ontology", err, mapRevisionError);
  }
}

export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });

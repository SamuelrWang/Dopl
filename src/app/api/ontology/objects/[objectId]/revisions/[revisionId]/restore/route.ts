import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { mapRevisionError } from "@/features/revisions/server/http-mapping";
import { buildOntologyContext, getSnapshot } from "@/features/ontology/server/service";
import { restoreObjectRevision } from "@/features/ontology/server/service-revisions-read";
import { deriveWorkspace } from "@/shared/api/workspace-derivation";

/**
 * `POST /api/ontology/objects/{objectId}/revisions/{revisionId}/restore` — write
 * ONE FIELD's prior value back.
 *
 * 🔒 Refused at `view`: the service gate is `requireObject(…, "edit")` (Q9).
 * `minRole: "guest"` matches the sibling PATCH; the LEVEL is the fence.
 *
 * 🔒 ⚠ Deliberately NOT `sessionOnly` — that gate is for acts that DESTROY. A
 * restore appends a revision and destroys nothing; share level fences it like PATCH.
 *
 * ⚠ Responds with the restored object read from the snapshot (the
 * audience-visible view), so the board patches without a second read.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const objectId = auth.params?.objectId;
    const revisionId = auth.params?.revisionId;
    if (!objectId) throw HttpError.badRequest("Missing objectId");
    if (!revisionId) throw HttpError.badRequest("Missing revisionId");
    // Optional `X-Updated-At` precondition (the MCP restore always sends it). Mismatch → 412.
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const ctx = buildOntologyContext(auth);
    await restoreObjectRevision(ctx, objectId, revisionId, expectedUpdatedAt);
    const snapshot = await getSnapshot(ctx);
    const object = snapshot.objects[objectId];
    if (!object) throw HttpError.notFound("Object not found");
    return NextResponse.json({ object });
  } catch (err) {
    return toHttpErrorResponse("ontology", err, mapRevisionError);
  }
}

export const POST = withWorkspaceAuth(handlePost, { workspaceFromParams: deriveWorkspace.ontologyObject, minRole: "guest" });

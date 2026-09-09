import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { mapRevisionError } from "@/features/revisions/server/http-mapping";
import { buildOntologyContext, getSnapshot } from "@/features/ontology/server/service";
import { restoreObjectRevision } from "@/features/ontology/server/service-revisions-read";

/**
 * `POST /api/ontology/objects/{objectId}/revisions/{revisionId}/restore` — write
 * ONE FIELD's prior value back.
 *
 * 🔒 **REFUSED AT `view`.** The service gate is `requireObject(…, "edit")` —
 * Q9's every-cluster write gate — so a lent reader granted `view` gets the same
 * 404 every other ontology write gives them. `minRole: "guest"` matches the
 * sibling `PATCH /api/ontology/objects/{objectId}`; the LEVEL is the fence.
 *
 * 🔒 ⚠ **DELIBERATELY *NOT* `sessionOnly`, AND THAT IS A DECISION RATHER THAN AN
 * OMISSION.** That gate exists for acts that DESTROY (the object DELETE beside
 * this route carries it, and the reasoning is there). A restore destroys
 * nothing: it appends a revision whose value already happened, and the source
 * revision is still there afterwards. The solo toggle and the share level are
 * what fence an agent here, exactly as they fence a PATCH.
 *
 * ⚠ THE RESPONSE IS THE RESTORED OBJECT, so the caller's board can be patched
 * without a second read. It is taken from the snapshot rather than returned by
 * the service, because the restore writes through `updateObject` and the object
 * the caller wants back is the one their audience can see.
 */
async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const objectId = auth.params?.objectId;
    const revisionId = auth.params?.revisionId;
    if (!objectId) throw HttpError.badRequest("Missing objectId");
    if (!revisionId) throw HttpError.badRequest("Missing revisionId");
    const ctx = buildOntologyContext(auth);
    await restoreObjectRevision(ctx, objectId, revisionId);
    const snapshot = await getSnapshot(ctx);
    const object = snapshot.objects[objectId];
    if (!object) throw HttpError.notFound("Object not found");
    return NextResponse.json({ object });
  } catch (err) {
    return toHttpErrorResponse("ontology", err, mapRevisionError);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });

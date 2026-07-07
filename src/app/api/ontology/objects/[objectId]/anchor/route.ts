import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { buildOntologyContext, claimAnchor } from "@/features/ontology/server/service";

async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const objectId = auth.params?.objectId;
    if (!objectId) throw HttpError.badRequest("Missing objectId");
    const object = await claimAnchor(buildOntologyContext(auth), objectId);
    return NextResponse.json({ object });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

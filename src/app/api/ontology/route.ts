import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { buildOntologyContext, getSnapshot } from "@/features/ontology/server/service";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const snapshot = await getSnapshot(buildOntologyContext(auth));
    return NextResponse.json(snapshot);
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

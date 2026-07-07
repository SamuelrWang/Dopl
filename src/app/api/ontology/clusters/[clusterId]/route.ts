import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { OntologyClusterUpdateSchema } from "@/features/ontology/schema";
import {
  buildOntologyContext,
  deleteCluster,
  updateCluster,
} from "@/features/ontology/server/service";

function clusterIdOf(auth: WorkspaceAuthContext): string {
  const clusterId = auth.params?.clusterId;
  if (!clusterId) throw HttpError.badRequest("Missing clusterId");
  return clusterId;
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyClusterUpdateSchema);
    const cluster = await updateCluster(buildOntologyContext(auth), clusterIdOf(auth), input);
    return NextResponse.json({ cluster });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    await deleteCluster(buildOntologyContext(auth), clusterIdOf(auth));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

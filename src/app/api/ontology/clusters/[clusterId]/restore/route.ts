import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { buildOntologyContext, restoreCluster } from "@/features/ontology/server/service";

function clusterIdOf(auth: WorkspaceAuthContext): string {
  const clusterId = auth.params?.clusterId;
  if (!clusterId) throw HttpError.badRequest("Missing clusterId");
  return clusterId;
}

// Restores a soft-deleted cluster and the objects it cascade-deleted. The
// `[clusterId]` segment accepts a slug OR id (the service resolves both over
// trashed rows). Same edit gate as the DELETE/PATCH cluster route.
async function handleRestore(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const cluster = await restoreCluster(buildOntologyContext(auth), clusterIdOf(auth));
    return NextResponse.json({ cluster });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const POST = withWorkspaceAuth(handleRestore, { minRole: "member" });

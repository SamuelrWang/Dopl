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
// 🔒 `sessionOnly` (2026-09-02). `dopl_ontology` advertises this deletion as
// APP-ONLY — "there is no MCP path to it, for any role or token" — and
// `packages/mcp-server/src/gating.ts › opRefusal` was the ONLY thing enforcing
// that sentence. A `full`-profile session has Bash and its own `dopl_at_*`
// bearer, so it reached THIS route over loopback and deleted the row the
// refusal had just declined: a prompt is not a fence. ⚠ AND THIS GATE IS NOW
// THE WHOLE FENCE: the `_admin` tool that carried the refusal was deleted once
// this landed, so removing `sessionOnly` here removes the RULE, not a second
// copy of it. ⚠ Per-METHOD — the reads and the PATCH stay ungated, because
// editing and rewriting are exactly what `delete-policy.ts › DELETE_REFUSAL`
// redirects an agent to instead.
// Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});

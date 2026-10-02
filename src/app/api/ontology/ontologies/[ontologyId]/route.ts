import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { OntologyUpdateSchema } from "@/features/ontology/schema";
import {
  buildOntologyContext,
  deleteOntology,
  updateOntology,
} from "@/features/ontology/server/service";

function ontologyIdOf(auth: WorkspaceAuthContext): string {
  const ontologyId = auth.params?.ontologyId;
  if (!ontologyId) throw HttpError.badRequest("Missing ontologyId");
  return ontologyId;
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyUpdateSchema);
    const ontology = await updateOntology(buildOntologyContext(auth), ontologyIdOf(auth), input);
    return NextResponse.json({ ontology });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    await deleteOntology(buildOntologyContext(auth), ontologyIdOf(auth));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
// 🔒 `sessionOnly` (2026-09-02): deletion is APP-ONLY — a `full`-profile
// session's own bearer must not reach it over loopback (a prompt is not a
// fence). ⚠ This gate is now the WHOLE fence; removing it removes the rule.
// Per-METHOD — PATCH stays ungated (it's what `delete-policy.ts › deleteRefusal`
// redirects agents to). Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});

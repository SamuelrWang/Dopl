import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { OntologyObjectUpdateSchema } from "@/features/ontology/schema";
import {
  buildOntologyContext,
  deleteObject,
  updateObject,
} from "@/features/ontology/server/service";

function objectIdOf(auth: WorkspaceAuthContext): string {
  const objectId = auth.params?.objectId;
  if (!objectId) throw HttpError.badRequest("Missing objectId");
  return objectId;
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyObjectUpdateSchema);
    // Optional `X-Updated-At` precondition. Mismatch → 412 ONTOLOGY_STALE_VERSION.
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const object = await updateObject(
      buildOntologyContext(auth),
      objectIdOf(auth),
      input,
      expectedUpdatedAt
    );
    return NextResponse.json({ object });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    await deleteObject(buildOntologyContext(auth), objectIdOf(auth));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; F-685).
// ⚠ The floor is not the gate: `service-gates.ts › requireObject` demands
// `edit` on EVERY ontology the object belongs to (Q9); no share → 404. Shares,
// ontology create/delete and `agentsMayEdit` deliberately stay above guest.
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "guest" });
// 🔒 `sessionOnly` (2026-09-02): deletion is APP-ONLY — a `full`-profile
// session's own bearer must not reach it over loopback (a prompt is not a
// fence). ⚠ This gate is now the WHOLE fence; removing it removes the rule.
// Per-METHOD — PATCH stays ungated (it's what `delete-policy.ts › deleteRefusal`
// redirects agents to). Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  // 🔒 `guest` since 2026-09-09 (see PATCH); `sessionOnly` keeps it app-only.
  minRole: "guest",
  sessionOnly: true,
});

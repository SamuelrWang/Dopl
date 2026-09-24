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

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; closes
// F-685). "are guests access/view or edit" — `edit` is half of that ruling, so
// the object/relationship/membership writes carry the same floor as the reads.
// ⚠ THE FLOOR IS THE WEAKEST FENCE HERE, not the gate: `service-gates.ts ›
// requireObject` demands `edit` on EVERY ontology the object belongs to (Q9),
// resolved from DB facts, and a guest whose share says `view` — or who has no
// share — gets the same 404 they got before this floor existed. ⚠ The SHARE
// lane, ontology create/delete and the `agentsMayEdit` toggle deliberately did
// NOT move: a guest lends nothing and re-widens nobody's agents.
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "guest" });
// 🔒 `sessionOnly` (2026-09-02). `dopl_ontology` advertises this deletion as
// APP-ONLY — "there is no MCP path to it, for any role or token" — and
// `packages/mcp-server/src/gating.ts › opRefusal` was the ONLY thing enforcing
// that sentence. A `full`-profile session has Bash and its own `dopl_at_*`
// bearer, so it reached THIS route over loopback and deleted the row the
// refusal had just declined: a prompt is not a fence. ⚠ AND THIS GATE IS NOW
// THE WHOLE FENCE: the `_admin` tool that carried the refusal was deleted once
// this landed, so removing `sessionOnly` here removes the RULE, not a second
// copy of it. ⚠ Per-METHOD — the reads and the PATCH stay ungated, because
// editing and rewriting are exactly what `delete-policy.ts › deleteRefusal`
// redirects an agent to instead.
// Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  // 🔒 `guest` since 2026-09-09 — see the PATCH above. `sessionOnly` is
  // UNTOUCHED and is what still keeps this verb app-only for every role.
  minRole: "guest",
  sessionOnly: true,
});

import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { OntologyShareWriteSchema } from "@/features/ontology/schema";
import { buildOntologyContext } from "@/features/ontology/server/service";
import {
  listOntologyShares,
  setOntologyShare,
  unshareOntology,
} from "@/features/ontology/server/service-shares";

/**
 * `GET|PUT|DELETE /api/ontology/ontologies/{ontologyId}/shares` — WHICH HOME
 * CHANNELS THIS ONTOLOGY IS LENT INTO, and the writes that change one.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * `GET`    → `{ canManage, shares: [{channelId, membersLevel, guestsLevel,
 *              ownerAgentsLevel}] }`. Absent from the list = not shared; there
 *              is no `{level:"none"}` row (I4).
 * `PUT`    body `{channelId, membersLevel, guestsLevel, ownerAgentsLevel?}` →
 *              `{ share }`. Upserts ONE channel's row and states the desired
 *              END state, so a retry after an ambiguous failure is idempotent.
 *              An absent `ownerAgentsLevel` SEEDS from the ontology's
 *              `agents_may_edit` on the first share and KEEPS the stored value
 *              afterwards (Q2).
 * `DELETE` `?channelId=` → `204`. Unshare is a row delete, and it is idempotent.
 *
 * ── 🔒 Why the writes are `sessionOnly` ─────────────────────────────────────
 * A share hands the ontology to people (guests included) — the `channel-grants`
 * argument. A `full`-profile session could read the device token off disk and
 * widen its own operator's audience; a prompt is not a fence. Pinned in
 * `write-gate-coverage.test.ts`. ⚠ Per-METHOD: `GET` is ungated (`member` — a
 * guest has nothing to lend). Also enforced in-service by
 * `service-shares.ts › assertHumanShareWrite`.
 *
 * ── The fences, in order (all in the service) ───────────────────────────────
 *  1. a PERSON is asking · 2. the ontology is the caller's OWN (404) ·
 *  3. the channel is one they are an active member of (404) ·
 *  4. its container is a HOME container (400, Q5).
 */

function ontologyIdOf(auth: WorkspaceAuthContext): string {
  const ontologyId = auth.params?.ontologyId;
  if (!ontologyId) throw HttpError.badRequest("Missing ontologyId");
  return ontologyId;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const body = await listOntologyShares(
      buildOntologyContext(auth),
      ontologyIdOf(auth)
    );
    return NextResponse.json(body);
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyShareWriteSchema);
    const share = await setOntologyShare(
      buildOntologyContext(auth),
      ontologyIdOf(auth),
      input
    );
    return NextResponse.json({ share });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // ⚠ Query param, not body: many clients can't send a DELETE body.
    const channelId = request.nextUrl.searchParams.get("channelId");
    if (!channelId) throw HttpError.badRequest("channelId is required");
    await unshareOntology(buildOntologyContext(auth), ontologyIdOf(auth), channelId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const GET = withWorkspaceAuth(handleGet, { minRole: "member" });
// 🔒 `sessionOnly` — see the docblock. Per-METHOD: the GET above is ungated.
export const PUT = withWorkspaceAuth(handlePut, {
  minRole: "member",
  sessionOnly: true,
});
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});

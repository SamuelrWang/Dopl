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
 * `GET|PUT|DELETE /api/ontology/clusters/{clusterId}/shares` — WHICH HOME
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
 * IT HANDS CONTENT TO A PERSON — the `channel-grants` argument verbatim. A
 * share at `members_level='view'` puts a whole ontology in front of every
 * member of a channel, GUESTS INCLUDED at `guests_level`, and `edit` hands them
 * a pen on the owner's own graph. A `full`-profile session has Bash, can read
 * the 90-day device token off disk, and would otherwise be one HTTP call from
 * widening its own operator's audience — a prompt is not a fence.
 * ⚠ A CONSCIOUS edit to `src/shared/auth/write-gate-coverage.test.ts`'s pinned
 * `sessionOnly` set. ⚠ Per-METHOD: the `GET` is ungated, because reading which
 * channels the caller's OWN ontology already reaches decides nothing — and it
 * is `minRole: "member"` all the same, since a guest has no ontology to lend.
 * ⚠ AND IT IS NOT THE ONLY COPY: `service-shares.ts › assertHumanShareWrite`
 * refuses an agent source inside the service, so a future caller reaching the
 * lane another way inherits the refusal rather than escaping it.
 *
 * ── The fences, in order (all in the service) ───────────────────────────────
 *  1. a PERSON is asking · 2. the ontology is the caller's OWN (404) ·
 *  3. the channel is one they are an active member of (404) ·
 *  4. its container is a HOME container (400, Q5).
 */

function clusterIdOf(auth: WorkspaceAuthContext): string {
  const clusterId = auth.params?.clusterId;
  if (!clusterId) throw HttpError.badRequest("Missing clusterId");
  return clusterId;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const body = await listOntologyShares(
      buildOntologyContext(auth),
      clusterIdOf(auth)
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
      clusterIdOf(auth),
      input
    );
    return NextResponse.json({ share });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // ⚠ A QUERY PARAMETER, not a body: a `DELETE` with a body is unreachable
    // from half the clients that would call it, and the pair is the address.
    const channelId = request.nextUrl.searchParams.get("channelId");
    if (!channelId) throw HttpError.badRequest("channelId is required");
    await unshareOntology(buildOntologyContext(auth), clusterIdOf(auth), channelId);
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

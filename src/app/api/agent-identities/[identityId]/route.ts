import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import {
  requireIdentityId,
  toAgentIdentityErrorResponse,
} from "@/shared/api/agent-identity-route";
import {
  buildAgentIdentityContext,
  deleteIdentity,
  readIdentityById,
  updateIdentity,
} from "@/features/agent-identities/server/service";
import { AgentIdentityUpdateSchema } from "@/features/agent-identities/schema";

/**
 * `GET | PATCH | DELETE /api/agent-identities/{identityId}`.
 *
 * ⚠ `sessionOnly` IS PER-METHOD AND ONLY `DELETE` CARRIES IT. GET and PATCH
 * stay reachable by an agent token on purpose — an orchestrator reads identities,
 * and letting it fix a typo in one is not a containment question. A DELETE is
 * permanent (no trash, no restore), it destroys something a whole team may be
 * spawning from, and an agent token has no confirm dialog to gate it — the same
 * argument that session-gates the team DELETE and the thread DELETE. Recorded
 * with that reasoning in `src/shared/auth/write-gate-coverage.test.ts`.
 *
 * ⚠ **AND THE READ AND THE WRITES NO LONGER RESOLVE THE ID THE SAME WAY (A12).**
 * GET goes through `readIdentityById`, so the id names its own container and a
 * `workspace=` that contradicts it is IGNORED. PATCH and DELETE stay on
 * `getIdentityById`, keyed to the workspace the caller was authorised in — a
 * write that followed an id across a tenancy boundary is a ruling nobody has
 * made.
 */

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentIdentityContext(auth);
    const identity = await readIdentityById(
      ctx,
      requireIdentityId(auth.params)
    );
    return NextResponse.json({ identity });
  } catch (err) {
    return toAgentIdentityErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentIdentityContext(auth);
    const id = requireIdentityId(auth.params);
    const patch = await parseJson(request, AgentIdentityUpdateSchema);
    // Optional `X-Updated-At` precondition — the same wire convention the KB,
    // skills and ontology writes carry. Mismatch → 412
    // AGENT_IDENTITY_STALE_VERSION; absent → last-writer-wins, which is what an
    // older bundled client still sends.
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const identity = await updateIdentity(ctx, id, patch, expectedUpdatedAt);
    return NextResponse.json({ identity });
  } catch (err) {
    return toAgentIdentityErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentIdentityContext(auth);
    await deleteIdentity(ctx, requireIdentityId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toAgentIdentityErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});

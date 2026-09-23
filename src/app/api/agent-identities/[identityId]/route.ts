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
 * `GET | PATCH | DELETE /api/agent-identities/{identityId}` — all three follow the id to its own
 * container. `sessionOnly` is per-method and only DELETE carries it: a permanent delete gets a human.
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
    // Optional `X-Updated-At` precondition: mismatch → 412, absent → last writer wins.
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

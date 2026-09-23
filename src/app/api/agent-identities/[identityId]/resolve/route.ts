import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import {
  requireIdentityId,
  toAgentIdentityErrorResponse,
} from "@/shared/api/agent-identity-route";
import {
  buildAgentIdentityContext,
  resolveIdentityForLaunch,
} from "@/features/agent-identities/server/service";

/**
 * `GET /api/agent-identities/{identityId}/resolve` — the launch contract the desktop fetches at spawn
 * (cookie-authed, as the operator): `ResolvedAgentIdentity`, or 404 for missing/invisible (never 403).
 * Gated by the same matrix via `readIdentityById`; knowledge is viewer-filtered and what it drops is a
 * count, never a location. Not `sessionOnly`: the desktop may present either credential.
 */

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentIdentityContext(auth);
    const resolved = await resolveIdentityForLaunch(
      ctx,
      requireIdentityId(auth.params)
    );
    return NextResponse.json(resolved);
  } catch (err) {
    return toAgentIdentityErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createTrustRule,
  deleteTrustRule,
  listTrustRules,
} from "@/features/channels/server/service";
import { TrustMutateSchema } from "@/features/channels/schema";

// Per-teammate standing consent, scoped to the caller (operator) in the active
// workspace. Self-only — the service always uses ctx.userId as the operator.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const rules = await listTrustRules(ctx);
    return NextResponse.json({ rules });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TrustMutateSchema);
    const ctx = buildChannelContext(auth);
    const rule = await createTrustRule(ctx, input.trustedUserId);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, TrustMutateSchema);
    const ctx = buildChannelContext(auth);
    await deleteTrustRule(ctx, input.trustedUserId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
/**
 * H-1 — `sessionOnly` on both mutations. A trust rule is standing consent: it
 * makes every future inbound request from that teammate auto-allow, so the
 * human is never asked again. That is a strictly bigger grant than any single
 * Allow, and the agent it would be granted to is the same
 * `--mcp-config`-spawned, Bash-capable session that is processing an
 * untrusted teammate's message — left open, an injected agent could POST
 * `{trustedUserId: <its requester>}` and permanently retire the gate on its
 * own machine. Revocation (DELETE) is gated for the mirror reason: an agent
 * must not be able to quietly drop a rule the human relies on either.
 *
 * The desktop only READS trust (cookie-authenticated GET, cached per
 * workspace); it never writes a rule, so nothing in the listener regresses.
 */
export const POST = withWorkspaceAuth(handlePost, { sessionOnly: true });
export const DELETE = withWorkspaceAuth(handleDelete, { sessionOnly: true });

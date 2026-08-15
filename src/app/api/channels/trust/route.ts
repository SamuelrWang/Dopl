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

// Per-teammate standing consent, scoped to the caller in the active workspace. Self-only — the
// service always uses ctx.userId as the operator.
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
 * ⚠ `sessionOnly` on BOTH mutations. A trust rule is standing consent — every future inbound
 * request from that teammate auto-allows — a strictly bigger grant than any single Allow, handed
 * to the same `--mcp-config`-spawned, Bash-capable session processing an untrusted teammate's
 * message. Ungated, an injected agent POSTs `{trustedUserId: <its requester>}` and permanently
 * retires the gate on its own machine. DELETE is gated for the mirror reason.
 *
 * The desktop only READS trust (cookie GET, cached per workspace), so nothing regresses.
 */
export const POST = withWorkspaceAuth(handlePost, { sessionOnly: true });
export const DELETE = withWorkspaceAuth(handleDelete, { sessionOnly: true });

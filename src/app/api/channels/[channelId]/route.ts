import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  deleteChannel,
  getChannel,
  updateChannel,
} from "@/features/channels/server/service";
import { ChannelUpdateSchema } from "@/features/channels/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const channel = await getChannel(ctx, requireChannelId(auth.params));
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * ⚠ FIELD-LEVEL `sessionOnly` — pinned by `src/shared/auth/write-gate-coverage.test.ts`.
 *
 * §9's granularity is per-METHOD, which is wrong HERE: this PATCH is FIVE writes behind one verb
 * (`name`, `topic`, `visibility`, `archived`, `infoCard`) and they do not share a gate. Gating the
 * whole method would spend an agent capability for nothing.
 *
 * - `visibility` is the SESSION-ONLY field gated HERE: an agent (`dopl_at_*`) may not change it at
 *   all. private→public exposes the entire channel AND its history to every workspace member. BOTH
 *   directions are gated because it is simpler and costs nothing — no MCP op or desktop call reaches
 *   this field (`@dopl/client` has no channel-update method), and direction-free means no read of the
 *   current row.
 * - `name` / `topic` / `archived` stay MANAGE-gated in the service (`canManageChannel`).
 * - `infoCard` is intentionally AGENT-WRITABLE and gated on MEMBERSHIP, not session (Samuel,
 *   2026-08-25): a home channel is "a relationship, not a tenancy", the card is its shared scratch
 *   surface, and it changes no visibility, roster, lifecycle or fact — so it is NOT in
 *   `SESSION_ONLY_FIELDS`. That gate and its byte fence both live in
 *   `channels/server/service-writes.ts › updateChannel`, not in this route.
 *
 * Session callers are untouched: cookie (web + desktop main) and Supabase-JWT (SPA) callers never
 * set `agentTokenId`, so `components/go-public-dialog.tsx` is unaffected.
 */
const SESSION_ONLY_FIELDS = ["visibility"] as const;

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const patch = await parseJson(request, ChannelUpdateSchema);
    const gated = SESSION_ONLY_FIELDS.filter((f) => patch[f] !== undefined);
    if (auth.agentTokenId && gated.length > 0) {
      throw new HttpError(
        403,
        "SESSION_REQUIRED",
        `Changing a channel's ${gated.join(", ")} requires an interactive Dopl ` +
          `session and can't be performed over an MCP connection. Sign in to ` +
          `the Dopl app to continue.`
      );
    }
    const ctx = buildChannelContext(auth);
    const channel = await updateChannel(ctx, requireChannelId(auth.params), patch);
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    await deleteChannel(ctx, requireChannelId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

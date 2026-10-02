import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  addMember,
  buildChannelContext,
  listChannelMembers,
  removeMember,
  updateMyMemberSettings,
} from "@/features/channels/server/service";
import {
  ChannelMemberAddSchema,
  ChannelMemberRemoveSchema,
  ChannelMemberSelfUpdateSchema,
} from "@/features/channels/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const members = await listChannelMembers(ctx, requireChannelId(auth.params));
    return NextResponse.json({ members });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMemberAddSchema);
    const ctx = buildChannelContext(auth);
    const member = await addMember(ctx, requireChannelId(auth.params), input.userId);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMemberRemoveSchema);
    const ctx = buildChannelContext(auth);
    await removeMember(ctx, requireChannelId(auth.params), input.userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// PATCH writes only the caller's OWN per-channel prefs (service targets ctx.userId),
// so any channel member may call it. Gate stays per-METHOD — see the note below.
async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ChannelMemberSelfUpdateSchema);
    const ctx = buildChannelContext(auth);
    const member = await updateMyMemberSettings(
      ctx,
      requireChannelId(auth.params),
      input
    );
    return NextResponse.json({ member });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ GET at guest (INVARIANTS §4A, §2B; channel fence is the true gate).
// POST/DELETE (roster management) stay member+.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
/**
 * ⚠ `agentToolProfile` is a CONTAINMENT CONTROL, so this PATCH is `sessionOnly` (§9).
 * 🔒 Closes: a spawned agent (90-day device token, Bash under a `full` profile) steered by an
 * untrusted teammate's message, reading its own bearer off disk and PATCHing itself back to
 * `full` — durably.
 *
 * Still per-METHOD with `favorite` added (INVARIANTS §3 re-decided, 2026-08-19): neither
 * field is a legitimate agent write (favorites are the operator's sidebar), and a field
 * gate would cost a second `SESSION_ONLY_FIELDS` route.
 *
 * POST/DELETE stay ungated by session — invites are a separate, unmade decision.
 * Session callers (cookies, Supabase JWT) never take the `dopl_at_*` branch.
 */
export const PATCH = withWorkspaceAuth(handlePatch, { sessionOnly: true });

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

// PATCH updates only the caller's OWN per-channel preferences, so any channel
// member — regardless of workspace role — may call it; the service enforces
// channel membership and always targets ctx.userId's row.
//
// SINCE F-170 THE ONLY FIELD IT CARRIES IS `agentToolProfile`
// (`ChannelMemberSelfUpdateSchema`) — notify scope left the product with the
// mute preference. That is what makes the METHOD, not a field, the right
// granularity for the gate below: there is nothing else on this PATCH for an
// agent to legitimately write.
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

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
/**
 * THE AGENT TOOL PROFILE IS A CONTAINMENT CONTROL, NOT A PREFERENCE (C-12,
 * Samuel 2026-08-10) — so this PATCH is `sessionOnly` (§9), exactly like
 * `PATCH /channels/consent/[id]` and `POST|DELETE /channels/trust`, and for the
 * same threat model those two spell out.
 *
 * The concrete attack it closes: the desktop hands every spawned agent a 90-day
 * `dopl.read`+`dopl.write` device token via `--mcp-config`, that agent's whole
 * job is to process an untrusted teammate's message, and a `full` profile has
 * live Bash — while `sdk-loader.js` fences only `Read/Grep/Glob` from secret
 * paths. Without this gate the agent reads its own bearer off disk and PATCHes
 * its profile back to `full` after the operator tightens it: the setting the
 * operator relies on for containment would be writable by the thing it
 * contains, DURABLY (the column outlives the session).
 *
 * PER-METHOD, WHICH IS ALSO PER-FIELD HERE — see the note above `handlePatch`.
 * `GET` stays open (reading the roster decides nothing), and `POST`/`DELETE`
 * (add / remove a member) are deliberately UNGATED: invites stay as they are
 * (C-13's invite half is a separate, unmade decision).
 *
 * NOT AN OUTAGE FOR THE OPERATOR'S OWN WRITE. The desktop authenticates with
 * Supabase session cookies (`main/api.js`) and the bundled SPA with a Supabase
 * access JWT — both are SESSION callers (`with-auth.ts`: only a `dopl_at_*`
 * bearer takes the OAuth branch), so neither reaches this gate. Nothing in
 * `dopl-desktop-app/main` PATCHes this route at all; it only READS
 * `myAgentToolProfile` off the channel DTO (`main/targeting-window.js`).
 */
export const PATCH = withWorkspaceAuth(handlePatch, { sessionOnly: true });

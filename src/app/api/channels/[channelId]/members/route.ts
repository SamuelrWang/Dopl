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

// PATCH writes only the caller's OWN per-channel prefs, so any channel member may call it
// regardless of workspace role; the service enforces membership and always targets ctx.userId.
// TWO fields since 2026-08-19 (`ChannelMemberSelfUpdateSchema`): `agentToolProfile` and
// `favorite`. The gate below stays per-METHOD — see its own note for why the second field did
// not turn it into a field gate.
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
 * ⚠ `agentToolProfile` IS A CONTAINMENT CONTROL, NOT A PREFERENCE — so this PATCH is
 * `sessionOnly` (§9), like `PATCH /channels/consent/[id]` and `POST|DELETE /channels/trust`.
 *
 * The attack it closes: the desktop hands every spawned agent a 90-day `dopl.read`+`dopl.write`
 * device token via `--mcp-config`; that agent processes an untrusted teammate's message and a
 * `full` profile has live Bash (`sdk-loader.js` fences only `Read/Grep/Glob` from secret paths).
 * Ungated, the agent reads its own bearer off disk and PATCHes itself back to `full` after the
 * operator tightens it — DURABLY, since the column outlives the session.
 *
 * ⚠ THE METHOD NOW CARRIES A SECOND FIELD AND IS STILL METHOD-GATED (2026-08-19). INVARIANTS §3
 * says per-method and per-field coincided here only because `agentToolProfile` was the sole
 * field — so `favorite` is exactly the case that rule told us to re-decide rather than inherit.
 * It stays per-METHOD because the answer to "is this a write an agent may legitimately make?" is
 * NO for both fields, for different reasons: the tool profile is a containment control, and a
 * favourite is the OPERATOR's own sidebar shortcut list — an agent reordering a human's sidebar
 * is not a capability with a use, and the cost of refusing it is that nobody can favourite from
 * an MCP session, which nobody asked to do. A field gate would buy an agent-writable `favorite`
 * and cost a second `SESSION_ONLY_FIELDS` route (§3: that is a conscious edit to the coverage
 * test, not a free choice).
 *
 * `GET` stays open; `POST`/`DELETE` (add/remove a member) are deliberately UNGATED — invites are
 * a separate, unmade decision.
 *
 * Not an outage for the operator: the desktop uses Supabase session cookies (`main/api.js`) and
 * the SPA a Supabase access JWT — only a `dopl_at_*` bearer takes the OAuth branch
 * (`with-auth.ts`), so neither reaches this gate.
 */
export const PATCH = withWorkspaceAuth(handlePatch, { sessionOnly: true });

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { getAccountStatus } from "@/features/channels/server/service";
// ⚠ ONE predicate, shared with the write path — see `lib/desktop-handle.ts`.
import { isOutsideSessionCaller } from "@/features/channels/lib/desktop-handle";
import { readRuntimeHeader } from "@/shared/auth/runtime-header";
import { AccountStatusQuerySchema } from "@/features/channels/schema";

/**
 * Account-wide channel status: every channel the caller is in, across workspaces
 * and home-channel containers, in one read (T20/T22).
 *
 * ⚠ `withUserAuth`, not `withWorkspaceAuth` — that wrapper 400s a 2+-membership
 * caller (INVARIANTS §4) and hides `kind='link'` containers (§4A). The fence is the
 * USER: every read enters through `channel_members.user_id = <caller>`.
 *
 * ⚠ No `?workspaceId=` / `X-Workspace-Id`: a narrower second answer is the mistake
 * removed from `GET /api/home/overview` (§4A). Use the per-workspace reads.
 *
 * 🔒 The container lock (B3) is per MCP connection, so it is applied in
 * `packages/mcp-server/src/workspace-directory.ts › narrowToLock`; a non-MCP caller
 * that skips it rebuilds the enumeration oracle B3 denies.
 *
 * 🔒 B1 (`apiKeyWorkspaceId`, a credential property) MUST be applied here (R3) — no
 * wrapper upstream enforces it; it narrows the membership proof in the service.
 *
 * ⚠ The session half carries operator-only telemetry; safe only because the
 * session read is fenced on `user_id` (`repository-account.ts › listAccountSessionStates`).
 *
 * Not `sessionOnly`: a read built for agent tokens.
 */
async function handleGet(
  request: NextRequest,
  {
    userId,
    apiKeyWorkspaceId,
    agentTokenId,
  }: {
    userId: string;
    apiKeyWorkspaceId?: string | null;
    /** Present for a `dopl_at_*` credential (`with-auth.ts`). */
    agentTokenId?: string;
  }
): Promise<Response> {
  try {
    const { since, view } = parseQuery(
      request.nextUrl.searchParams,
      AccountStatusQuerySchema,
      ["since", "view"]
    );
    const status = await getAccountStatus(userId, {
      since,
      view,
      // 🔒 B1's ceiling (R3): nothing upstream applies the lock.
      lockedWorkspaceId: apiKeyWorkspaceId ?? null,
      // `@desktop` lanes are for an outside session only (2026-09-18), decided from
      // the credential + runtime header via the write path's predicate.
      // 🔒 This excludes the desktop-run agent, which shares the operator's user id
      // and would otherwise adopt asks aimed at the operator's laptop.
      outsideSession: isOutsideSessionCaller(
        agentTokenId ? "agent" : "user",
        readRuntimeHeader(request) ?? null
      ),
    });
    return NextResponse.json(status, {
      // ⚠ Per-caller and volatile by construction — never cacheable.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withUserAuth(handleGet);

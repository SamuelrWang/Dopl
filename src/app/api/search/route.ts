import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { runSearch } from "@/features/search/server/service";
import { SEARCH_QUERY_KEYS, SearchQuerySchema } from "@/features/search/schema";

/**
 * **GLOBAL SEARCH** — `?q=<text>&scope=account`, or
 * `?q=<text>&scope=container&container=<workspaceId>` (Samuel, 2026-09-17: the
 * search popup, *"separated into sections … basically doing a text search across
 * the home space"*).
 *
 * ⚠ **`withUserAuth`, AND IT COULD NOT BE `withWorkspaceAuth`** — the same
 * argument `GET /api/channels/account/status` makes in full. That wrapper
 * resolves exactly ONE workspace and answers 400 `WORKSPACE_REQUIRED` to a
 * caller with 2+ standard memberships (INVARIANTS §4), which is precisely the
 * caller `scope=account` exists for, and it filters `kind='link'` containers out
 * of auto-targeting (§4A), so a home channel would be unsearchable through it
 * even for a single-workspace caller. **The fence is the USER**: every read
 * behind this route enters through `workspace_members.user_id = <caller>` or
 * `channel_members.user_id = <caller>` (`search/server/repository-reach.ts`).
 *
 * 🔒 **`container` IS A LABEL, NEVER A PERMISSION.** It narrows the membership
 * PROOF itself rather than filtering its output, so a container the caller does
 * not belong to yields an empty reach and one 403 — the same 403 a container
 * that does not exist yields. No route-level pre-check exists to disagree with
 * the service (the `artifacts` route's rule: one authority, or the two drift).
 *
 * 🔒 **B1 — `ctx.apiKeyWorkspaceId` — IS APPLIED HERE AND HAS TO BE (R3).** A
 * container lock is a property of the CREDENTIAL (`mcp_tokens.workspace_id`) and
 * `withWorkspaceAuth` 403s on it on every other route; this route does not use
 * that wrapper, so nothing upstream enforces it and a locked credential would
 * otherwise search every container its operator belongs to.
 *
 * ⚠ **NOT `sessionOnly` AND NOT WRITE-SCOPED** — it is a `GET`, and an agent
 * token is a caller it is built for. There is no `DELETE`/`PATCH` on this path.
 */
async function handleGet(
  request: NextRequest,
  {
    userId,
    credentialSubjectUserId,
    apiKeyWorkspaceId,
  }: {
    userId: string;
    credentialSubjectUserId: string | null;
    apiKeyWorkspaceId?: string | null;
  }
): Promise<Response> {
  try {
    const { q, scope, container } = parseQuery(
      request.nextUrl.searchParams,
      SearchQuerySchema,
      SEARCH_QUERY_KEYS
    );
    const result = await runSearch(
      {
        userId,
        credentialSubjectUserId,
        // 🔒 B1's CEILING (R3) — the credential's own lock, never a request field.
        lockedWorkspaceId: apiKeyWorkspaceId ?? null,
      },
      { q, scope, container }
    );
    return NextResponse.json(result, {
      // ⚠ Per-caller and per-keystroke by construction — never cacheable.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse("search", err);
  }
}

export const GET = withUserAuth(handleGet);

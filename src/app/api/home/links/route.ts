import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HomeLinkMintSchema } from "@/features/home/schema";
import { listMyPendingLinks } from "@/features/home/server/service-reads";
import { mintContainerLink } from "@/features/home/server/service-writes";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/links";

/** GET — the caller's still-usable LEGACY UNBOUND links (bound links show on
 *  their channel row as `linkOut`, so they're filtered to avoid duplicates).
 *  ⚠ Keyed `pendingLinks`, matching `HomeChannelsPayload`. */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    return NextResponse.json(
      { pendingLinks: await listMyPendingLinks(userId) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return toHttpErrorResponse(SOURCE, err);
  }
});

/**
 * POST — add a person to a channel: mint the link BOUND to `workspaceId`. Any
 * MEMBER of that container may (Samuel's ruling, 2026-08-24); non-member 404,
 * full container 409. The raw token is never its own field (only inside the
 * claim URL), so nothing logs one by accident.
 */
export const POST = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const input = await parseJson(request, HomeLinkMintSchema);
      // ⚠ `private, no-store` — the body carries a single-use claim URL; a
      // shared cache MUST NOT retain an invitation token.
      return NextResponse.json(
        await mintContainerLink(userId, input.workspaceId, input),
        { headers: { "Cache-Control": "private, no-store" } }
      );
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  },
  // sessionOnly: mints an account-entry credential (same class as join-link).
  // ⚠ Unlike `POST /api/channels?scope=account`, this reaches a person.
  { sessionOnly: true }
);

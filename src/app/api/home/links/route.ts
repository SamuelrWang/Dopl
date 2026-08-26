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

/** GET — the caller's still-usable LEGACY UNBOUND links. Revoked, expired and
 *  exhausted rows are filtered server-side, and so are BOUND ones: a bound link
 *  belongs to its channel's row as `linkOut`, and listing it here too would show
 *  one invitation twice.
 *  ⚠ Keyed `pendingLinks`, the SAME name the channels payload gives the same
 *  rows (`HomeChannelsPayload`) — one surface, one word for a thing. */
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
 * MEMBER of that container may (Samuel's ruling, 2026-08-24); a non-member 404s
 * and a full container 409s. The response carries the full claim URL; the raw
 * token is never a field of its own, so nothing downstream can log one by
 * accident.
 */
export const POST = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const input = await parseJson(request, HomeLinkMintSchema);
      // ⚠ `private, no-store` — the body carries the single-use claim URL, the
      // same credential class the sibling `POST /api/home/channels` and the GET
      // above both guard. A shared cache MUST NOT retain an invitation token.
      return NextResponse.json(
        await mintContainerLink(userId, input.workspaceId, input),
        { headers: { "Cache-Control": "private, no-store" } }
      );
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  },
  // sessionOnly: mints an account-entry credential, same class as
  // `POST /api/workspaces/[workspaceSlug]/join-link`. ⚠ Unlike its sibling
  // `POST /api/home/channels`, which an agent MAY call — this one reaches a
  // person, and that is the line.
  { sessionOnly: true }
);

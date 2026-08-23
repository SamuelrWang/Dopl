import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HomeLinkMintSchema } from "@/features/home/schema";
import { listMyPendingLinks } from "@/features/home/server/service-reads";
import { mintLink } from "@/features/home/server/service-writes";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/links";

/** GET — the caller's still-usable links. Revoked, expired and exhausted rows
 *  are filtered server-side; the list is what can still be shared.
 *  ⚠ Keyed `pendingLinks`, the SAME name the relationships payload gives the
 *  same rows (`HomeRelationshipsPayload`) — one surface, one word for a thing. */
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

/** POST — mint a link. The response carries the full claim URL; the raw token
 *  is never a field of its own, so nothing downstream can log one by accident. */
export const POST = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const input = await parseJson(request, HomeLinkMintSchema);
      return NextResponse.json(await mintLink(userId, input));
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  },
  // sessionOnly: mints an account-entry credential, same class as
  // `POST /api/workspaces/[workspaceSlug]/join-link`.
  { sessionOnly: true }
);

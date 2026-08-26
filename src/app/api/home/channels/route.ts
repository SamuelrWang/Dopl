import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HomeChannelCreateSchema } from "@/features/home/schema";
import { getHomeChannels } from "@/features/home/server/service-reads";
import { createHomeChannel } from "@/features/home/server/service-writes";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/channels";

/**
 * The account surface's own channels. ⚠ REPLACES `/api/home/relationships`
 * (deleted 2026-08-24) — the rename is the inversion made visible: a home
 * channel exists before it has a second person in it, so "relationship" was the
 * wrong noun for the thing being listed. Old desktop builds address the old
 * path; the version gate is what stops them (INVARIANTS §13).
 *
 * ⚠ NOT workspace-scoped, so `withUserAuth` and no `X-Workspace-Id`. The fence
 * is the caller's own membership rows — a link container the caller does not
 * belong to is not reachable from any query here.
 */

/** GET — the home page in one round trip: the caller's channels and their own
 *  still-open LEGACY unbound links (`HomeChannelsPayload`). */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    return NextResponse.json(await getHomeChannels(userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse(SOURCE, err);
  }
});

/**
 * POST — "New channel": a solo container plus one private channel inside it.
 *
 * ⚠ DELIBERATELY NOT `sessionOnly` (Samuel's ruling, 2026-08-24), matching
 * `POST /api/workspaces`. An agent token may create a home channel — that is
 * the point of a channel you are alone in — because creating one mints nothing
 * that reaches another person. The link that DOES is `POST /api/home/links`,
 * and that one is session-gated.
 */
export const POST = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const input = await parseJson(request, HomeChannelCreateSchema);
      return NextResponse.json(await createHomeChannel(userId, input), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  }
);

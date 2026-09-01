import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  getHomeOverview,
  parseRange,
} from "@/features/home/server/service-overview";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/overview";

/**
 * GET `?range=24h|7d|30d|month` — the /home Overview face's `HomeOverview`: the
 * per-channel / per-person / per-tool breakdowns, the recent-thread and live
 * agent lists, everything blocked on the caller, and the scan denominator the
 * breakdowns are measured over.
 *
 * ⚠ NOT WORKSPACE-SCOPED, so `withUserAuth` and no `X-Workspace-Id`, exactly
 * like its `/api/home/channels` sibling. **The fence is the caller's own
 * membership rows**: the service builds the container id list from
 * `repository-containers.ts › listLinkContainers` and hands it to the
 * repository as the entire fence (every read below is service-role and bypasses
 * RLS, so that list is the only thing standing between a reader and a count).
 *
 * 🔒 **`workspaceId` IS GONE (Samuel, 2026-09-01) AND ITS REMOVAL IS A BUG FIX.**
 * The param used to narrow this payload to one container so the page could
 * render a channel-scoped panel BELOW the account-wide one — built from the same
 * components, so an operator with a single home channel saw every section drawn
 * twice from two payloads that were identical by construction. The face is
 * cross-channel now and there is exactly one payload. ⚠ **Do not reintroduce
 * the param**: it is not a harmless option, it is the second half of a duplicate
 * render.
 *
 * ⚠ **AN UNRECOGNISED `range` IS A 400, NEVER A DEFAULT WINDOW** (§9) — a page
 * that answers for the last 30 days under a "24h" heading is worse than an
 * error. The page itself only ever asks for `month`.
 */
export const GET = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const range = parseRange(request.nextUrl.searchParams.get("range"));
      const overview = await getHomeOverview(userId, range);
      // ⚠ Per-caller data — the fence is this caller's containers — so never
      // CDN-cacheable by URL alone.
      return NextResponse.json(overview, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  }
);

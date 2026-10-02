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
 * ⚠ Not workspace-scoped (`withUserAuth`, like `/api/channels?scope=account`).
 * 🔒 The fence is the caller's own membership rows
 * (`repository-containers.ts › listLinkContainers`); every read is service-role,
 * so that list is the only fence.
 *
 * 🔒 No `workspaceId` (Samuel, 2026-09-01) — it caused a duplicate render of
 * the same payload; do not reintroduce it.
 *
 * ⚠ Unrecognised `range` → 400, never a default window (§9).
 */
export const GET = withUserAuth(
  async (request: NextRequest, { userId }: Ctx) => {
    try {
      const range = parseRange(request.nextUrl.searchParams.get("range"));
      const overview = await getHomeOverview(userId, range);
      // ⚠ Per-caller data — never CDN-cacheable by URL.
      return NextResponse.json(overview, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (err) {
      return toHttpErrorResponse(SOURCE, err);
    }
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { readTokenSpend } from "@/features/channels/server/service";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/token-spend";

/**
 * ⚠ Fixed 31-day window, no `range` param: the face has no switcher
 * (`overview-panels.tsx`), and 31 matches `ThreadActivityStrip`'s window.
 */
const WINDOW_DAYS = 31;

/**
 * GET — the /home Overview token-spend strip: tokens the CALLER'S OWN agents
 * spent over the last 31 days (Samuel, #1326).
 *
 * 🔒 Own-scoped, and that is the whole fence: reads only the spender column of
 * `workspace_token_spend`, account-wide; no `workspaceId` (same as `./overview`).
 *
 * ⚠ Own route, not a `metric` on `./overview-series` — a different ledger with
 * a different accuracy story (tokens are a FLOOR).
 *
 * ⚠ Answers RUNS, not days (Samuel, 2026-09-06): the strip buckets by the
 * operator's LOCAL day, which the server can't know
 * (`service-token-spend.ts › readTokenSpend`). The 31×24h window is deliberately
 * wider than 31 local days so the oldest column is never short.
 *
 * ⚠ No realtime, no poll (INVARIANTS §7): cold read, `private, no-store`.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    const since = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const report = await readTokenSpend(userId, since);
    return NextResponse.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse(SOURCE, err);
  }
});

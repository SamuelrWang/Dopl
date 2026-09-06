import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { readTokenSpend } from "@/features/channels/server/service";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/token-spend";

/**
 * ⚠ THE WINDOW IS FIXED AT 31 DAYS AND THERE IS NO `range` PARAM, because the
 * surface has no switcher — `overview-panels.tsx` states that rule for the whole
 * face ("NO RANGE SWITCHER"), and a parameter no caller varies is a door with no
 * lock on it. 31 is `thread-activity.tsx › ThreadActivityStrip`'s own window, so
 * the two time strips on this product cover the same span.
 */
const WINDOW_DAYS = 31;

/**
 * GET — the /home Overview token-spend strip: how many tokens the CALLER'S OWN
 * agents have spent, per day, over the last 31 days (Samuel, #1326: "track over
 * time how many tokens were spent on agents and have that be persistent
 * knowledge in the overview").
 *
 * 🔒 **OWN-SCOPED, AND THE SCOPE IS THE WHOLE FENCE.** `workspace_token_spend`
 * rows carry the user whose machine spent the tokens, and this reads that column
 * alone — so it is account-wide across containers (which is what Overview is)
 * and there is no argument that could widen it to a peer's spend. No
 * `workspaceId` param, for the same reason `./overview` has none.
 *
 * ⚠ **ITS OWN ROUTE RATHER THAN A `metric` ON `./overview-series`** — see that
 * file's corrected block: those three metrics all sum `credit_usage_events`, and
 * tokens are a different ledger with a different accuracy story (a FLOOR, not an
 * exact count).
 *
 * ⚠ **AN EMPTY `marks` ARRAY IS THE HONEST ANSWER BEFORE THE MIGRATION LANDS**,
 * and it is the same answer as "no agent has spent anything this month" — both
 * mean the page has nothing to draw.
 *
 * ⚠ **IT ANSWERS RUNS, NOT DAYS** (Samuel's ruling, 2026-09-06). The strip
 * buckets by the operator's LOCAL day and this server cannot know that zone, so
 * each run travels as its own instant and the renderer names the days — see
 * `service-token-spend.ts › readTokenSpend`. ⚠ The window here is 31×24h ending
 * NOW, which is deliberately WIDER than the 31 local days the strip draws: a
 * narrower one would leave the oldest local column short at every hour of the
 * day except local midnight.
 *
 * ⚠ **NO REALTIME AND NO POLL** (INVARIANTS §7), like every other read on this
 * face: a cold read, `private, no-store`.
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

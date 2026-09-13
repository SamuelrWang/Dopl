import { HttpError } from "@/shared/lib/http-error";
import {
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
  type HomeOverviewRange,
} from "../overview-types";
import type { CreditChannelScope } from "./repository-overview";

/**
 * THE /home USAGE HISTOGRAM'S TWO NARROWINGS — `channel` and `month` — parsed,
 * and resolved into the origin-container ids the ledger read can be narrowed by
 * (2026-09-13, Samuel over the Overview: *"where you see 'Credits used', I want
 * you to put a dropdown where the user can select: all channels / specific
 * channels / just desktop agent usage … I also want a left and right arrow that
 * will let me change the month I'm looking at"*).
 *
 * ⚠ **ITS OWN MODULE, AND IT DOES NO IO.** `service-overview.ts` was at 420
 * lines of the 500 cap (§1) on the day this landed, and these are pure
 * functions the suite can pin without a single mock — the same seam
 * `overview-tally.ts` already is.
 *
 * 🔒 **THE LEDGER HAS A `channel_id` COLUMN SINCE 2026-09-13 (rule B), AND THIS
 * FILE IS WHERE THE SCOPE VOCABULARY MEETS IT.** ⚠ **THE SUPERSEDED VERSION OF
 * THIS HEADER SAID THERE WAS NO SUCH COLUMN** and resolved a scope to
 * `origin_workspace_id` — the ADDRESSED container — on the argument that a
 * container holds exactly one channel. Rule B breaks that identity: the channel
 * that PAYS and the container that was ADDRESSED are different rows whenever an
 * agent reaches across containers, so the old dimension put a home channel's
 * burn against a workspace KB in NO bucket at all and the breakdown stopped
 * summing to the wallet (`billing/server/credit-ledger.ts › CreditUsageEvent`).
 * So now:
 *   - **a channel** is its OWN id — `HomeChannel.channelId`, not the container's;
 *   - **the Desktop agent** is `channel_id IS NULL`: MCP traffic with no calling
 *     channel, plus every row written before the column existed;
 *   - **there is no third thing.** The two buckets PARTITION the wallet's rows,
 *     which is what makes the filtered views sum to the unfiltered one.
 */

/* ⚠ **THE TWO SCOPE WORDS LIVE ON `../overview-types.ts`, NOT HERE** — the
   renderer spells them too and may not import a `server/` module
   (`eslint.config.mjs`'s SPA fence). One declaration, both sides. */

/** `YYYY-MM`, the only month spelling this endpoint accepts. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A channel id is a uuid — the shape check that keeps a garbage string from ever
 *  being handed on. ⚠ SHAPE ONLY: what makes it safe to pass to the admin client
 *  is the payer fence on the scan itself, not this regex
 *  (`resolveUsageChannel`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `channel` off the query string. Absent → `null` (the whole wallet).
 *
 * ⚠ **AN UNRECOGNISED VALUE IS A 400, the same rule `parseRange` /
 * `parseMetric` hold**: a plot narrowed to something nobody asked for is worse
 * than an error, and silently ignoring the param would draw the WHOLE wallet
 * under a channel's name.
 */
export function parseUsageScope(raw: string | null): string | null {
  if (raw === null || raw === "" || raw === USAGE_SCOPE_ALL) return null;
  if (raw === USAGE_SCOPE_DESKTOP || UUID_PATTERN.test(raw)) return raw;
  throw new HttpError(
    400,
    "INVALID_CHANNEL",
    `channel must be a channel id, "${USAGE_SCOPE_DESKTOP}", or "${USAGE_SCOPE_ALL}"`
  );
}

/**
 * `month=YYYY-MM` → the anchor the window is built from (the 1st of that month,
 * UTC). Absent → `null`, i.e. the current month.
 *
 * 🔒 **IT IS AN ANCHOR FOR THE `month` RANGE AND FOR NOTHING ELSE — A `month`
 * BESIDE A ROLLING RANGE IS A 400.** `rangeWindows` reads `now` two ways: for
 * `month` it takes only the year and the month (the whole calendar month), for
 * `24h`/`7d`/`30d` it ends the window AT `now`. Honouring an anchor on a rolling
 * range would answer "the 30 days ending on the 1st of March" under a heading
 * that says the last 30 days — a window nobody asked for, which is exactly what
 * this endpoint's parsers exist to refuse.
 * ⚠ **THE ANCHOR IS MIDDAY, NOT MIDNIGHT.** `rangeWindows` builds the month from
 * `getUTCFullYear()`/`getUTCMonth()`, so any instant inside the month does; noon
 * is the one that cannot be walked into the previous month by a timezone
 * mistake downstream.
 */
export function parseUsageMonth(
  raw: string | null,
  range: HomeOverviewRange
): Date | null {
  if (raw === null || raw === "") return null;
  const found = MONTH_PATTERN.exec(raw);
  if (!found) {
    throw new HttpError(400, "INVALID_MONTH", "month must be YYYY-MM");
  }
  if (range !== "month") {
    throw new HttpError(
      400,
      "INVALID_MONTH",
      "month applies to range=month only"
    );
  }
  return new Date(Date.UTC(Number(found[1]), Number(found[2]) - 1, 1, 12));
}

/**
 * The scope word → the ledger read's channel narrowing.
 *
 * - `null` scope → `null`: **no narrowing at all** — the whole wallet.
 * - `desktop` → `"unattributed"`, i.e. `channel_id IS NULL`.
 * - a uuid → that CHANNEL's rows.
 *
 * 🔒 **NO OWNERSHIP INTERSECTION, AND THAT IS A CHANGE WITH AN ARGUMENT (§2).**
 * The superseded version intersected the requested id with the reader's OWN
 * containers, because a container id is an ADDRESSING input and this read runs on
 * the RLS-bypassing admin client. A channel id is not: the scan's fence is
 * `payer_user_id = reader` (plus the legacy origin arm, still built from ids the
 * repository read itself), so this narrowing composes as an `AND` that can only
 * HIDE the reader's own rows. **Nothing a caller sends can widen the answer**, so
 * there is nothing left for an intersection to protect — and dropping it dropped
 * a round trip with it (`repository-overview.ts › scanCreditEvents`).
 *
 * ⚠ **A CHANNEL THE READER DOES NOT OWN STILL ANSWERS A ZERO-FILLED MONTH, NOT A
 * REFUSAL** — it just resolves through the wallet fence to no rows. A channel they
 * merely JOINED spends the OWNER's wallet, and "none of your credits went there"
 * is the true answer. ⚠ It is now that answer by CONSTRUCTION rather than by a
 * short-circuit the service had to remember to write.
 */
export function resolveUsageChannel(
  scope: string | null
): CreditChannelScope | null {
  if (scope === null) return null;
  if (scope === USAGE_SCOPE_DESKTOP) return "unattributed";
  return { channelId: scope };
}

import { HttpError } from "@/shared/lib/http-error";
import {
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
  type HomeOverviewRange,
} from "../overview-types";
import type { OwnedWalletContainer } from "./repository-overview";

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
 * 🔒 **THE CREDIT LEDGER HAS NO `channel_id` COLUMN AND THIS FILE IS WHERE THAT
 * FACT IS STATED.** `credit_usage_events`' channel dimension is
 * `origin_workspace_id` — the ADDRESSED CONTAINER, and a container holds exactly
 * one channel (`billing/server/credit-ledger.ts › CreditUsageEvent`,
 * `overview-tally.ts › tallyChannels`, which keys on the same column). So:
 *   - **a channel** is its `kind='link'` container's id, the very id the /home
 *     channel list already carries as `HomeChannel.workspaceId`;
 *   - **the Desktop agent** — MCP traffic with no channel — is the reader's own
 *     `kind='personal'` shelf, which is what a call naming no container is
 *     resolved to, and which is the row `tallyChannels` documents as having "no
 *     channel to sit under";
 *   - **a NULL origin is neither.** The column is `ON DELETE SET NULL`, so a
 *     null means a DELETED container. It is real spend with no placeable source
 *     and it belongs to no filtered view — only to "All channels".
 */

/* ⚠ **THE TWO SCOPE WORDS LIVE ON `../overview-types.ts`, NOT HERE** — the
   renderer spells them too and may not import a `server/` module
   (`eslint.config.mjs`'s SPA fence). One declaration, both sides. */

/** `YYYY-MM`, the only month spelling this endpoint accepts. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A container id is a uuid — the shape check that keeps a garbage string from
 *  ever being handed on, even though the service also intersects it with the
 *  reader's own list. */
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
    `channel must be a container id, "${USAGE_SCOPE_DESKTOP}", or "${USAGE_SCOPE_ALL}"`
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
 * The scope → the origin containers the ledger read may be narrowed to.
 *
 * - `null` scope → `null`: **no narrowing at all**, which is not the same as
 *   "every owned container" — a row whose container was deleted (null origin)
 *   is still the reader's spend and still belongs on the unfiltered plot.
 * - `desktop` → every OWNED `kind='personal'` container.
 * - a container id → that id, **but only if the reader owns it.**
 *
 * 🔒 **THE INTERSECTION IS THE FENCE, AND IT COSTS NO ROUND TRIP (INVARIANTS
 * §2).** The caller already read this list to build the wallet predicate, so
 * narrowing against it is free — and it means no id a caller sent is ever handed
 * to the RLS-bypassing admin client. ⚠ **AN UNOWNED ID ANSWERS `[]`, WHICH THE
 * SERVICE RENDERS AS A ZERO-FILLED MONTH RATHER THAN A REFUSAL** — a channel the
 * reader merely JOINED is a legitimate row in their channel list, and its burns
 * spend the OWNER's wallet, so "none of your credits went there" is the true
 * answer, not a 400.
 */
export function resolveUsageOrigins(
  scope: string | null,
  containers: readonly OwnedWalletContainer[]
): string[] | null {
  if (scope === null) return null;
  if (scope === USAGE_SCOPE_DESKTOP) {
    return containers
      .filter((container) => container.kind === "personal")
      .map((container) => container.id);
  }
  return containers.some((container) => container.id === scope) ? [scope] : [];
}

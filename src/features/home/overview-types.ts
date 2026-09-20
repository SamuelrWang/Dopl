/**
 * Home OVERVIEW contracts — the account surface's analytics face (2026-09-01).
 *
 * ⚠ SEPARATE FILE FROM `types.ts`, ON PURPOSE. That one is the CHANNEL LIST's
 * contract and it changes when the invite/roster mechanics do; this one changes
 * when a metric is added or a data source is found. One file per reason to
 * change (INVARIANTS §1).
 *
 * ⚠ **EVERY FIGURE HERE IS BACKED BY A COLUMN THAT EXISTS.** What the schema
 * cannot answer is ABSENT rather than zeroed.
 *
 * ⚠ **THE TWO CREDIT OMISSIONS THIS FILE USED TO DECLARE ARE CLOSED
 * (2026-09-01).** It said there could be no credit SERIES and no credits PER
 * PERSON, both because `workspace_credit_usage` is a one-row-per-period
 * COUNTER with no user or channel dimension — which was true of that table and
 * is why **F-328** stood. Samuel asked for both anyway, so the gap was closed at
 * the schema: `20260901120000_credit_usage_events.sql` adds an attribution
 * LEDGER beside the counter, written per burn by
 * `billing/server/credit-ledger.ts`. The counter is still the only authority on
 * enforcement.
 *   - ⚠ **THE LEDGER'S FIGURES ARE A FLOOR, NOT A TOTAL** — because this page's
 *     read of it is CAPPED. ⚠ The superseded line said "twice over", the second
 *     reason being a fire-and-forget writer; that writer is gone (F-693, the row
 *     is written inside the counter's transaction). Nothing here is "exact".
 *   - ⚠ **AND IT STARTS EMPTY.** There is no history behind the migration, so
 *     every credit figure reads zero until traffic accrues. ⚠ The superseded
 *     line said the series answers an EMPTY array for that reason; it ZERO-FILLS
 *     instead (Samuel, 2026-09-01) — see {@link HomeOverviewSeries.points}.
 */

import type { Role } from "@/features/workspaces/types";

/**
 * The window every figure in a payload is measured over.
 *
 * ⚠ A CLOSED SET, and an unrecognised value is a 400 — never a fall-through to
 * a default window, which would draw an answer to a question nobody asked
 * (INVARIANTS §9, the same rule `parseSeriesMetric` follows).
 */
export type HomeOverviewRange = "24h" | "7d" | "30d" | "month";

export const HOME_OVERVIEW_RANGES: readonly HomeOverviewRange[] = [
  "24h",
  "7d",
  "30d",
  "month",
];

/**
 * What the /home Overview face asks for, and the ONLY range it asks for since
 * the switcher was removed (Samuel, 2026-09-01: the histogram shows a full
 * month).
 *
 * ⚠ `month` IS MONTH-TO-DATE, NOT THE WHOLE CALENDAR MONTH — bins run from the
 * 1st through the bin `now` falls in and stop. Extending to the 31st would draw
 * empty bars for days that have not happened, which reads as a quiet month
 * rather than an unfinished one.
 *
 * ⚠ **THE OTHER THREE ARE NOT DEAD — they are the ROUTE's contract**, which is
 * general and still validates all four. What is gone is a CONTROL on this page,
 * not an input to the API.
 */
export const HOME_OVERVIEW_DEFAULT_RANGE: HomeOverviewRange = "month";

/** What one {@link HomeSeriesPoint} spans. `24h` bins by hour, the rest by day. */
export type HomeOverviewBucket = "hour" | "day";

/**
 * Which series the histogram is showing.
 *
 * ⚠ **`credits` LANDED 2026-09-01 AND IT IS A DIFFERENT SHAPE OF READ.** `mcp`
 * and `messages` are counted per bin, exactly; `credits` is SUMMED from the
 * `credit_usage_events` ledger, which PostgREST cannot aggregate — so that arm
 * hauls the window once and bins in the service, and reports `truncated`.
 * ⚠ It is also the only arm that can be EMPTY FOR A GOOD REASON: the ledger
 * starts at its migration, so there is no history behind it. An empty credit
 * series renders as "nothing yet", never as zeroed bars.
 *
 * ⚠ **STILL NO `tokens` MEMBER**: `channel_sessions.tokens_spent` is a LIVE
 * PER-SESSION SNAPSHOT the desktop overwrites in place, so binning it by any
 * timestamp on that row attributes a whole session's running total to one
 * instant and then keeps growing it.
 */
export type HomeOverviewMetric = "credits" | "mcp" | "messages";

export const HOME_OVERVIEW_METRICS: readonly HomeOverviewMetric[] = [
  "credits",
  "mcp",
  "messages",
];

/**
 * The ONE metric the /home histogram draws.
 *
 * 🔒 **`credits`, AND THE CHART HAS NO SWITCHER (Samuel, verbatim: "I explicitly
 * said not to do MCP calls but credits. Why is there a MCP option").** The Usage
 * panel is about credits; MCP traffic lives on the same face as the **Top MCP
 * tools** rail and messages as the **Messages by channel** rail.
 *
 * ⚠ **THE EMPTY-LEDGER FAILURE THIS ONCE CAUSED IS FIXED AT THE SERVER, NOT
 * HERE.** Defaulting to credits used to render nothing, because the series
 * answered an empty array when the ledger held no rows. It now ZERO-FILLS every
 * day of the month (`service-overview.ts › getHomeOverviewSeries`), so the axis
 * is always drawn and a young ledger reads as a flat month that fills in.
 *
 * ⚠ THE ROUTE STILL ACCEPTS ALL THREE METRICS — it is a general endpoint with
 * its own contract tests. What is pinned is what this PAGE asks for.
 */
export const HOME_OVERVIEW_DEFAULT_METRIC: HomeOverviewMetric = "credits";

/** One bin. `at` is the bin's START, ISO-8601 UTC. */
export interface HomeSeriesPoint {
  at: string;
  count: number;
}

/** Payload of `GET /api/home/overview-series`. */
export interface HomeOverviewSeries {
  range: HomeOverviewRange;
  metric: HomeOverviewMetric;
  bucket: HomeOverviewBucket;
  /**
   * Always the full bin count for the range, oldest first, ZERO-FILLED — a bin
   * with no rows was counted and really is zero.
   *
   * ⚠ **IT IS UNCONDITIONAL ON ALL THREE METRICS SINCE 2026-09-01 (Samuel: he
   * wants to SEE the month), AND THE SUPERSEDED PARAGRAPH HERE SAID THE
   * OPPOSITE.** It said `credits` sends an EMPTY array on an empty window so the
   * surface can say "nothing yet" — an honesty argument that cost him the chart
   * entirely while the ledger is young. `service-overview.ts ›
   * getHomeOverviewSeries` zero-fills the credits arm too; the axis is the frame
   * and the page never loses it. The trade he took knowingly: a zero bar on a day
   * before the ledger existed is unmeasured, and the axis cannot say so.
   */
  points: HomeSeriesPoint[];
  /** TRUE when the `credits` haul came back AT its ceiling; always false for
   *  the counted metrics, which have no cliff (§9). */
  truncated: boolean;
}

/**
 * ⚠ **`HomeUsageTotals` IS DELETED (Samuel, 2026-09-01).** It carried the six
 * figures behind the row of stat tiles at the top of the Overview face — MCP
 * calls, messages, threads opened, sessions, running sessions and the token sum
 * with its two-part denominator — and Samuel removed that row outright in
 * favour of the three activity panels. The reads went with it
 * (`repository-overview.ts` records which five). **Do not restore the type
 * without its reads**: an interface nothing populates is how a surface comes to
 * render six confident zeroes.
 */

/**
 * One person's CREDIT spend in the window.
 *
 * ⚠ **IT WAS `mcpCalls` UNTIL 2026-09-01 AND THE SWAP IS THE POINT (Samuel).**
 * `mcp_tool_calls` counts LOOPBACK REQUESTS, so it was a shape rather than a
 * cost; the `credit_usage_events` ledger counts what was actually charged. The
 * guest split is unchanged and is still the reason this rail exists.
 *
 * ⚠ `role` IS THE CONTAINER ROLE, read from `workspace_members` — which is the
 * ONLY place `guest` exists. `channel_members.role` is `owner|member` and has
 * no guest arm, so it can never answer this question
 * (`channels/server/dto.ts` says so in as many words).
 */
export interface HomePersonUsage {
  userId: string;
  /** Display name, then email, then `""` — the transcript's own precedence. */
  name: string;
  /** `null` when the caller no longer shares a container with them (a departed
   *  member's spend survives them). */
  role: Role | null;
  /** Summed `credit_usage_events.amount`. ⚠ A FLOOR — this scan is capped. */
  credits: number;
}

/** One home channel's traffic in the window. */
export interface HomeChannelUsage {
  /** The `kind='link'` container — how every home surface addresses a channel. */
  workspaceId: string;
  name: string;
  /** Summed from the ledger's `origin_workspace_id`, which IS the channel
   *  dimension (a container holds exactly one channel). ⚠ A FLOOR, same two
   *  reasons as {@link HomePersonUsage.credits}. */
  credits: number;
  messages: number;
}

/** One `(tool, op)` pair's traffic in the window. ⚠ There is no MCP SERVER
 *  dimension anywhere in the schema; `tool`/`op` is the finest grain that
 *  exists. */
export interface HomeToolUsage {
  tool: string;
  op: string;
  calls: number;
}

/**
 * Payload of `GET /api/home/overview` — one round trip for a whole face.
 *
 * ⚠ **CROSS-CHANNEL, FULL STOP (Samuel, 2026-09-01).** The `scope` field and the
 * `?workspaceId=` narrowing are GONE, and their removal is the fix for the
 * duplication Samuel saw: the face used to stack an account-wide panel over a
 * channel-scoped one rendering the SAME components, so an operator with one home
 * channel got every section, rail and stat tile drawn twice from two payloads
 * that were by definition identical. Every section on this face is now
 * account-wide by construction, so there is no second panel to disagree with.
 *
 * 🔒 **THE `agents` FIELD IS GONE (Samuel, 2026-09-20: the Activity panel is
 * removed from /home Overview).** The panel was its ONLY reader, so the read
 * went with the face rather than sitting in the payload feeding nobody — the
 * same call the workspace Overview's own Activity cut made (`cb7b4d61`).
 * `HomeAgentRow`, `EMPTY_AGENTS`, `overview-tally.ts`'s agent mapper and
 * `repository-overview.ts`'s running-session read all left in that change.
 * ⚠ **NO WIRE BREAK HERE, unlike that one**: /home's reader always spelled the
 * §8 `?? EMPTY_AGENTS` fallback, so an older installed bundle reading this
 * payload draws an empty board rather than throwing.
 * ⚠ **THE BOARD COMPONENT IS NOT GONE** — `apps/desktop-ui/src/components/
 * overview/agent-board.tsx` and the WORKSPACE Overview that hosts it are
 * untouched; that face has its own read (`workspaces/server/service-usage.ts`).
 */
export interface HomeOverview {
  range: HomeOverviewRange;
  /** Window start, ISO-8601 UTC — what every figure below is measured from. */
  since: string;
  /** Descending by `credits`. */
  channels: HomeChannelUsage[];
  /** Descending by `credits`. */
  people: HomePersonUsage[];
  /** Descending by `calls`, capped. */
  tools: HomeToolUsage[];
  /**
   * Rows the per-channel / per-person / per-tool SCANS covered.
   *
   * ⚠ THE DENOMINATOR TRAVELS WITH THE SHARES, which is the standing rule and
   * the reason a scan is allowed here at all
   * (`workspaces/server/repository-overview.ts › listRecentUserMessageAuthors`
   * is the precedent).
   */
  scanned: number;
  /** TRUE when a scan came back AT its ceiling — the breakdowns are then a
   *  FLOOR, and the surface has to say so (§9: a clipped read SAYS SO).
   *  ⚠ **AND WHEN IT IS FALSE THE CREDIT RAILS ARE A TOTAL SINCE 2026-09-13**:
   *  the superseded note said they were a floor regardless because the ledger's
   *  writer was fire-and-forget, and that writer is gone (F-693). */
  truncated: boolean;
}

/**
 * Absent-fallbacks for the array keys, per INVARIANTS §8: these payloads are
 * IndexedDB-persisted, so an entry written by an older bundle can be missing a
 * key this one `.map`s over — which THROWS and blanks the pane. Spell
 * `?? EMPTY_X` inline at every read.
 *
 * ⚠ FROZEN and shared: they reach render paths directly, so a caller that
 * pushed into one would be editing every other caller's fallback.
 *
 * ⚠ **`EMPTY_PERSON_USAGE` AND `EMPTY_TOOL_USAGE` ARE THE WORKSPACE OVERVIEW'S
 * TOO** (2026-09-17) — `workspaces/types.ts` declared a second symbol under
 * each of those names, so one name resolved to two objects by import specifier.
 * Its CHANNEL fallback stays its own as `EMPTY_WORKSPACE_CHANNEL_USAGE`: that
 * row is keyed `channelId`, this one `workspaceId`.
 */
export const EMPTY_SERIES: readonly HomeSeriesPoint[] = Object.freeze([]);
export const EMPTY_CHANNEL_USAGE: readonly HomeChannelUsage[] = Object.freeze([]);
export const EMPTY_PERSON_USAGE: readonly HomePersonUsage[] = Object.freeze([]);
export const EMPTY_TOOL_USAGE: readonly HomeToolUsage[] = Object.freeze([]);

/**
 * THE USAGE HISTOGRAM'S SCOPE VOCABULARY — the two values that are not a
 * container id (2026-09-13, Samuel's scope dropdown).
 *
 * 🔒 **IT LIVES ON THE WIRE TYPES, NOT IN THE SERVER PARSER, BECAUSE BOTH SIDES
 * SPELL IT.** The SPA sends it and `home/server/overview-series-params.ts`
 * parses it — and the SPA may not import a feature's `server/` layer at all
 * (`eslint.config.mjs`'s renderer fence). A second literal on the client is how a
 * reserved word and its parser part.
 *
 * ⚠ **RESERVED WORDS, NOT IDS**, so neither can collide with a container uuid:
 * `all` is "no narrowing" (the default, sent as no param at all) and `desktop`
 * is MCP spend made outside any channel.
 */
export const USAGE_SCOPE_ALL = "all";
export const USAGE_SCOPE_DESKTOP = "desktop";

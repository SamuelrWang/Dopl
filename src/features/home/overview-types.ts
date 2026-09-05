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
 *   - ⚠ **THE LEDGER'S FIGURES ARE A FLOOR, NOT A TOTAL**, twice over: its
 *     writer is fire-and-forget (a dropped insert costs an attribution row, not
 *     a credit) and this page's read of it is capped. Nothing here may be
 *     labelled "exact".
 *   - ⚠ **AND IT STARTS EMPTY.** There is no history behind the migration, so
 *     every credit figure reads zero until traffic accrues. The series answers
 *     an EMPTY array rather than zeroed bins for exactly this reason — see
 *     {@link HomeOverviewSeries.points}.
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
   * ⚠ **THAT SENTENCE IS TRUE OF `mcp` AND `messages` AND CONDITIONAL FOR
   * `credits`**: those two are counted per bin, so a zero was measured. The
   * credit ledger only exists from its migration forward, so the service sends
   * an EMPTY array — not zeroed bins — when the window holds no ledger rows at
   * all, and the surface says "nothing yet" rather than drawing a flat month
   * that claims nothing was spent.
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
  /** Summed `credit_usage_events.amount`. ⚠ A FLOOR — the ledger's writer is
   *  fire-and-forget and this scan is capped. */
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
 * One live agent session.
 *
 * 🔒 **PUBLIC COLUMNS ONLY, AND THE OMISSIONS ARE THE CONTRACT.** There is no
 * `model`, no `toolLabel`, no `tokensSpent`, no context pair — those are the
 * OPERATOR-ONLY seven (`20260822150000_channel_sessions_telemetry.sql`), and a
 * home container holds another PERSON whose sessions run on THEIR machine.
 * Samuel's ruling: a peer learns THAT an agent is working, never what it costs
 * its operator. ⚠ **Do not widen this interface** — the repository's column list
 * and this shape are the fence on a service-role path where the usual DTO fence
 * (`collab-dto.ts › mapPeerSessionStateRow`) does not run.
 */
export interface HomeAgentRow {
  id: string;
  workspaceId: string;
  channelName: string;
  /** The agent's handle. */
  name: string;
  /** `working` / `idle` — anything the desktop has not reported as `ended`. */
  state: string;
  /** One of six CLOSED situation keys, or `null`. ⚠ Narrowed on the way out; an
   *  unrecognised key reads as `null` rather than being rendered. */
  detail: string | null;
  /** The thread it is working in, or `null` for a channel-level launch. */
  threadTitle: string | null;
  /**
   * `channel_sessions.task_id` — where clicking this row LANDS, `null` for a
   * channel-level launch (the jump then opens the channel with no thread).
   *
   * ⚠ **PUBLIC, and the migration says so in as many words** —
   * `20260822150000_channel_sessions_telemetry.sql` classifies `task_id` PUBLIC
   * ("which thread. Already on the peer card."). It is a jump TARGET, not
   * telemetry: it says where the work is, never what it costs.
   */
  threadId: string | null;
  /** TRUE when this session runs on the CALLER'S machine. ⚠ The only thing that
   *  distinguishes "my agent" from "theirs" without naming the peer. */
  mine: boolean;
  updatedAt: string;
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
  /** Live agent sessions, newest activity first, capped. ⚠ NOT window-scoped —
   *  a session row is live STATE, not an event. */
  agents: HomeAgentRow[];
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
   *  ⚠ The credit rails are a floor even when this is false, because their
   *  writer is fire-and-forget; `credit-ledger.ts` carries that. */
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
 */
export const EMPTY_SERIES: readonly HomeSeriesPoint[] = Object.freeze([]);
export const EMPTY_CHANNEL_USAGE: readonly HomeChannelUsage[] = Object.freeze([]);
export const EMPTY_PERSON_USAGE: readonly HomePersonUsage[] = Object.freeze([]);
export const EMPTY_TOOL_USAGE: readonly HomeToolUsage[] = Object.freeze([]);
export const EMPTY_AGENTS: readonly HomeAgentRow[] = Object.freeze([]);

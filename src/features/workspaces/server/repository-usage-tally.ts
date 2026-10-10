import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * THE FOUR GROUP-BYS POSTGRES DOES FOR THE WORKSPACE OVERVIEW — its credit
 * series, its two credit rails, its tool rail and the message figure beside the
 * channel one.
 *
 * ⚠ **ITS OWN FILE BESIDE `repository-usage.ts`, NOT A WIDENING OF IT** — the
 * same seam `repository-usage.ts` itself was split on, and the 500-line cap (§1)
 * is only half the reason. These reads differ in KIND from the ones next door:
 * they answer GROUPS rather than rows, they cannot reach the `max_rows` ceiling,
 * and every one of them returns `null` when its function has not been applied so
 * the caller can fall back to the haul beside it. Keeping them together is what
 * makes that contract one sentence instead of four.
 *
 * 🔒 **THEY EXIST BECAUSE THE HAULS WERE A WRONG ANSWER, NOT A SLOW ONE**
 * (Samuel #2935). `supabase/config.toml › max_rows` clips every select at 1,000
 * server-side and raises NOTHING, so a 10,000-row ask over a calendar month came
 * back as the newest 1,000 rows and the JS folds in `service-usage.ts` ran over
 * whatever survived. The SQL ships as an unapplied migration, which is why the
 * degrade is the LIVE path and is tested as one.
 *
 * ⚠ **EVERY FUNCTION TAKES `workspaceId` FROM `segment.ts › resolveApiWorkspace`
 * AND NOTHING A CALLER SENT.** These run on the service-role admin client, which
 * BYPASSES RLS (§2), so the argument list IS the fence — and the SQL pushes it
 * down, which means there are no rows left for `service-usage.ts ›
 * isWorkspaceSeatBurn` to re-filter on these paths. `usage-rails-row-cap.test.ts`
 * pins both wallet arms textually instead.
 *
 * ⚠ THE ADMIN CLIENT IS UNTYPED HERE for the reason `repository-overview.ts`
 * gives: the generated `Database` type carries neither these tables nor these
 * functions.
 */

/** Postgres/PostgREST codes for "that function is not there" — the aggregates
 *  below ship as an UNAPPLIED migration, so this is the LIVE path until Samuel
 *  applies it. ⚠ Distinct from the ledger-missing codes: a missing RPC still has
 *  readable rows, so the caller degrades to the capped scan rather than zeroing. */
const RPC_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** Codes for "the table itself is not there" — `credit_usage_events` or one of
 *  its v2 columns ships unapplied too. ⚠ The same migration-lag degrade
 *  {@link scanWorkspaceCreditEvents} documents: an empty ledger is truthful. */
const LEDGER_MISSING_CODES = new Set(["42P01", "42703"]);

/** `[startIso, endIso)` — the credit series' outer bounds. */
export interface UsageWindow {
  startIso: string;
  endIso: string;
}

/**
 * WHAT AN AGGREGATE'S ERROR MEANS, decided in ONE place for all four of them.
 *
 * `"degrade"` — the function is not there yet (an unapplied migration, which is
 * this directory's standing gate), so the caller falls back to its capped scan
 * and reports `truncated`. `"empty"` — the TABLE is not there, which is the same
 * migration-lag degrade the scans already carry: nothing recorded yet is a
 * truthful reading. Anything else THROWS, because an aggregate that fails for a
 * reason nobody predicted must not quietly read as zero spend.
 *
 * ⚠ LOGGED, never silent: a quiet unmetered panel looks like a quiet month.
 */
function degradeAggregate(
  fn: string,
  error: { code?: string | null; message?: string }
): "degrade" | "empty" {
  if (RPC_MISSING_CODES.has(error.code ?? "")) {
    console.warn(
      `[workspaces/overview] ${fn} absent, degrading to the capped scan: ${error.message}`
    );
    return "degrade";
  }
  if (LEDGER_MISSING_CODES.has(error.code ?? "")) {
    console.warn(
      `[workspaces/overview] ${fn} unreadable, degrading to empty: ${error.message}`
    );
    return "empty";
  }
  throw error;
}

/**
 * CREDITS SUMMED PER BIN, BY POSTGRES — the workspace histogram's read since
 * Samuel #2935.
 *
 * 🔒 **IT REPLACES A HAUL POSTGREST SILENTLY CLIPPED.**
 * {@link scanWorkspaceCreditEvents} asked for {@link WORKSPACE_SCAN_LIMIT} raw
 * rows newest first and `service-usage.ts` binned them in memory; `max_rows`
 * cut that to the newest 1,000, so a container whose busiest day exceeds the cap
 * drew a month of credits that all landed on the newest few days. One row per bin
 * puts the ceiling two orders of magnitude from the data: ≤31 rows.
 *
 * ⚠ **THE WALLET FENCE AND BOTH CONTAINER ARMS LIVE IN THE SQL NOW**, which is
 * the one place this read differs in KIND from the scan it replaces: an aggregate
 * returns sums, so there are no rows left for `service-usage.ts ›
 * isWorkspaceSeatBurn` to re-filter. **The "filtered twice on purpose" belt does
 * not reach this path** — `usage-rails-row-cap.test.ts` and
 * `credit-series-row-cap.test.ts` pin the arms textually instead.
 *
 * ⚠ **KEYED BY THE BIN'S START, NORMALISED THROUGH `Date`.** PostgREST renders
 * `timestamptz` as `+00:00` and `overviewWindows` builds `…Z`; comparing those as
 * strings matches nothing and zero-fills the whole month.
 *
 * ⚠ **RETURNS `null` WHEN THE FUNCTION IS ABSENT, AND THAT IS NOT AN ERROR.** The
 * migration is written, not applied, so until it lands the caller must still
 * answer: it degrades to the old scan and reports `truncated` honestly rather
 * than drawing a blank plot. An absent LEDGER is the other case and answers an
 * EMPTY map, matching {@link scanWorkspaceCreditEvents}'s degrade.
 */
export async function sumWorkspaceCreditBins(
  workspaceId: string,
  channelIds: readonly string[],
  win: UsageWindow,
  bucket: "hour" | "day",
  channelId: string | null = null
): Promise<Map<string, number> | null> {
  const { data, error } = await supabaseAdmin().rpc(
    "workspace_credit_usage_bins",
    {
      p_workspace_id: workspaceId,
      p_channel_ids: channelIds,
      p_since: win.startIso,
      p_until: win.endIso,
      p_bucket: bucket,
      p_channel_id: channelId,
    }
  );
  if (error) {
    const degraded = degradeAggregate("workspace_credit_usage_bins", error);
    return degraded === "empty" ? new Map() : null;
  }
  const bins = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    bin_start: string;
    credits: number | string;
  }>) {
    const at = Date.parse(row.bin_start);
    if (Number.isNaN(at)) continue;
    // ⚠ `bigint` crosses the wire as a STRING; `sum()` of an empty group never
    // reaches here, so there is no null arm.
    bins.set(new Date(at).toISOString(), Number(row.credits));
  }
  return bins;
}

/** Credits and the EVENT COUNT behind them, for one grouping key. ⚠ `key` is
 *  `null` for the Desktop-agent bucket (no channel) and for a deleted account
 *  (`user_id` is `ON DELETE SET NULL`) — a key the rails drop and the DENOMINATOR
 *  still counts. */
export interface WorkspaceCreditTallyRow {
  key: string | null;
  credits: number;
  events: number;
}

/** Both credit rails out of one pass over the ledger. */
export interface WorkspaceCreditTally {
  /** Credits per `channel_id`. */
  channels: WorkspaceCreditTallyRow[];
  /** Credits per `user_id`. */
  people: WorkspaceCreditTallyRow[];
}

/**
 * CREDITS GROUPED PER CHANNEL AND PER PERSON, BY POSTGRES — the two credit rails.
 *
 * 🔒 **ONE STATEMENT, TWO GROUPING SETS.** Two functions would scan the ledger
 * twice for one panel; a single `(channel, person)` grid has `channels × members`
 * rows and a busy container could push it back THROUGH the 1,000-row ceiling,
 * which is the bug being removed. Two single-column grouping sets are bounded by
 * `channels + members`.
 *
 * ⚠ **`events` IS `WorkspaceUsageBreakdown.scanned`, AND IT IS EXACT NOW** rather
 * than "however many rows survived the clip". Either grouping set covers every
 * matching row, so one dimension's total is the window's.
 *
 * ⚠ Same fence, same `null`-on-absent contract as {@link sumWorkspaceCreditBins}.
 */
export async function tallyWorkspaceCredits(
  workspaceId: string,
  channelIds: readonly string[],
  sinceIso: string
): Promise<WorkspaceCreditTally | null> {
  const { data, error } = await supabaseAdmin().rpc(
    "workspace_credit_usage_tally",
    {
      p_workspace_id: workspaceId,
      p_channel_ids: channelIds,
      p_since: sinceIso,
    }
  );
  if (error) {
    const degraded = degradeAggregate("workspace_credit_usage_tally", error);
    return degraded === "empty" ? { channels: [], people: [] } : null;
  }
  const tally: WorkspaceCreditTally = { channels: [], people: [] };
  for (const row of (data ?? []) as Array<{
    dimension: string;
    tally_key: string | null;
    credits: number | string;
    events: number | string;
  }>) {
    const into = row.dimension === "person" ? tally.people : tally.channels;
    into.push({
      key: row.tally_key,
      // ⚠ `bigint` crosses the wire as a STRING — unconverted, `+` concatenates.
      credits: Number(row.credits),
      events: Number(row.events),
    });
  }
  return tally;
}

/** One `(tool, op)` pair and how many calls it made. */
export interface WorkspaceToolTallyRow {
  tool: string;
  op: string;
  calls: number;
}

/**
 * MCP CALLS COUNTED PER `(tool, op)` PAIR, BY POSTGRES — the by-tool rail.
 *
 * 🔒 It replaces {@link scanWorkspaceMcpCalls}' two-column haul, which asked for
 * 10,000 rows and received the newest 1,000: the rail then described those 1,000
 * calls under a label reading the whole month. A pair per row is bounded by the
 * MCP surface itself, which is dozens.
 *
 * ⚠ **BOTH PUSHDOWN FILTERS MOVED WITH IT** — the await-polling exclusion and
 * {@link MCP_CALL_ROWS} — and the SQL spells the first as the sentence it always
 * was, `NOT (tool = 'channel' AND op LIKE 'await%')`, instead of De Morgan's
 * PostgREST workaround. `usage-rails-row-cap.test.ts` pins both.
 *
 * ⚠ Same `null`-on-absent contract as {@link sumWorkspaceCreditBins}.
 * ⚠ `mcp_tool_calls` has shipped since 2026-07-16, so there is no table-missing
 * arm to degrade to empty — a 42P01 here would be a real fault and throws.
 */
export async function tallyWorkspaceMcpTools(
  workspaceId: string,
  sinceIso: string
): Promise<WorkspaceToolTallyRow[] | null> {
  const { data, error } = await supabaseAdmin().rpc("workspace_mcp_tool_tally", {
    p_workspace_id: workspaceId,
    p_since: sinceIso,
  });
  if (error) {
    if (!RPC_MISSING_CODES.has(error.code ?? "")) throw error;
    console.warn(
      `[workspaces/overview] workspace_mcp_tool_tally absent, degrading to the capped scan: ${error.message}`
    );
    return null;
  }
  return ((data ?? []) as Array<{
    tool_name: string;
    op_name: string | null;
    calls: number | string;
  }>).map((row) => ({
    tool: row.tool_name,
    // ⚠ The column is `NOT NULL DEFAULT ''`; the coalesce is for the aggregate's
    // own shape, so a null can never become the string "null" in a rail key.
    op: row.op_name ?? "",
    calls: Number(row.calls),
  }));
}

/**
 * MESSAGES COUNTED PER CHANNEL, BY POSTGRES — the by-channel rail's second figure.
 *
 * 🔒 It replaces {@link scanWorkspaceMessageChannels}' single-column haul, which
 * asked for 10,000 ids and received the newest 1,000, so a busy container's rail
 * under-counted every channel and said nothing. One row per channel is bounded by
 * the container.
 *
 * ⚠ **A CHANNEL WITH NO MESSAGES IS ABSENT FROM THE MAP, NOT ZERO IN IT** — the
 * rail seeds a row for every VISIBLE channel first (`service-usage.ts ›
 * tallyWorkspaceChannels`), which is the only thing that knows which channels the
 * caller may be shown at all.
 * ⚠ Same `null`-on-absent contract as {@link sumWorkspaceCreditBins}.
 */
export async function tallyWorkspaceChannelMessages(
  workspaceId: string,
  sinceIso: string
): Promise<Map<string, number> | null> {
  const { data, error } = await supabaseAdmin().rpc(
    "workspace_message_channel_tally",
    { p_workspace_id: workspaceId, p_since: sinceIso }
  );
  if (error) {
    if (!RPC_MISSING_CODES.has(error.code ?? "")) throw error;
    console.warn(
      `[workspaces/overview] workspace_message_channel_tally absent, degrading to the capped scan: ${error.message}`
    );
    return null;
  }
  const out = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    billed_channel_id: string | null;
    messages: number | string;
  }>) {
    if (!row.billed_channel_id) continue;
    out.set(row.billed_channel_id, Number(row.messages));
  }
  return out;
}

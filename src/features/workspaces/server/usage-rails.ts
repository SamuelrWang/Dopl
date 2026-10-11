import "server-only";
import {
  scanWorkspaceCreditEvents,
  scanWorkspaceMcpCalls,
  scanWorkspaceMessageChannels,
  type UsageScan,
  type WorkspaceCreditEventRow,
} from "./repository-usage";
import {
  tallyWorkspaceChannelMessages,
  tallyWorkspaceCredits,
  tallyWorkspaceMcpTools,
  type WorkspaceCreditTallyRow,
  type WorkspaceToolTallyRow,
} from "./repository-usage-tally";

/**
 * THE WORKSPACE OVERVIEW'S THREE RAILS, ASSEMBLED FROM EITHER SOURCE — Postgres'
 * `GROUP BY`, or the capped haul it degrades to.
 *
 * ⚠ **ITS OWN FILE BESIDE `service-usage.ts`, NOT A WIDENING OF IT** (§1's
 * 500-line cap, and the seam `repository-usage.ts` was split on one layer down).
 * The rails now have TWO sources per figure, and the whole point of this module
 * is that the shape they meet in is written ONCE: everything downstream —
 * `tallyWorkspaceChannels`, `tallyWorkspacePeople`, `tallyWorkspaceTools` — takes
 * a tally and cannot tell which path produced it.
 *
 * 🔒 **AND THIS IS WHERE "FILTERED TWICE ON PURPOSE" LIVES** ({@link
 * isWorkspaceSeatBurn}, re-exported by `service-usage.ts` for its callers). The
 * aggregates push that predicate into SQL and return SUMS, so they have no rows
 * for the belt to re-check; the fold applies it. `usage-rails-row-cap.test.ts`
 * pins the SQL arms textually to make up the difference.
 */

/**
 * IS THIS LEDGER ROW ONE OF **THIS WORKSPACE'S SEAT WALLETS** PAID FOR?
 *
 * 🔒 The definition behind every credit figure on this page, and the disjoint
 * twin of `home/server/overview-tally.ts › isPersonalWalletBurn` — a row cannot
 * satisfy both, because `wallet` cannot be `personal` and `seat` at once.
 *
 * ⚠ **FILTERED TWICE ON PURPOSE.** `repository-usage.ts ›
 * scanWorkspaceCreditEvents` pushes the same predicate into PostgREST; this is
 * the DEFINITION, and it fails closed if the pushdown is ever loosened.
 * ⚠ `wallet` is NOT narrowed to a union — the column has no `CHECK`, so an
 * unknown wallet is not this workspace's, which fails closed.
 */
export function isWorkspaceSeatBurn(
  row: WorkspaceCreditEventRow,
  workspaceId: string,
  channelIds: ReadonlySet<string>
): boolean {
  if (row.wallet !== "seat" && row.wallet !== "workspace") return false;
  if (row.origin_workspace_id === workspaceId) return true;
  return row.channel_id !== null && channelIds.has(row.channel_id);
}

/** The second half of "filtered twice on purpose", applied once however the
 *  rows were fetched. */
export function filterSeatBurns(
  scan: UsageScan<WorkspaceCreditEventRow>,
  workspaceId: string,
  channelIds: ReadonlySet<string>
): UsageScan<WorkspaceCreditEventRow> {
  return {
    rows: scan.rows.filter((row) =>
      isWorkspaceSeatBurn(row, workspaceId, channelIds)
    ),
    truncated: scan.truncated,
  };
}

/** Tool + op, as one map key. A tool with no op keys on the tool alone rather
 *  than on a trailing separator. ⚠ Exported so the fold here and
 *  `service-usage.ts › tallyWorkspaceTools` cannot spell it two ways. */
export function toolKey(tool: string, op: string): string {
  return op ? `${tool}:${op}` : tool;
}

/* ------------------------- rails, however they came ---------------------- */

/**
 * THE TWO CREDIT RAILS' INPUT, which Postgres groups and the degrade path folds.
 *
 * ⚠ **`events` IS THE DENOMINATOR (`scanned`), AND IT IS NOT `channels.size`.**
 * One channel can hold ten thousand burns; the shares travel beside the number of
 * EVENTS they were computed from (§9).
 */
export interface CreditRails {
  /** Credits per `channel_id`. */
  channels: Map<string, number>;
  /** Credits per `user_id`. */
  people: Map<string, number>;
  events: number;
  truncated: boolean;
}

/** The by-tool rail's input. */
export interface ToolRail {
  rows: WorkspaceToolTallyRow[];
  calls: number;
  truncated: boolean;
}

/** The by-channel rail's MESSAGE figure. */
export interface MessageRail {
  byChannel: Map<string, number>;
  messages: number;
  truncated: boolean;
}

/** A tally row into a map, dropping the `null` key. ⚠ The Desktop-agent bucket
 *  and the deleted account are REAL rows of the denominator and no row of a rail
 *  that prints a name. */
function keyedCredits(rows: readonly WorkspaceCreditTallyRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.key === null) continue;
    out.set(row.key, (out.get(row.key) ?? 0) + row.credits);
  }
  return out;
}

/**
 * RAW LEDGER ROWS → the same shape the aggregate answers in, THROUGH the TS
 * predicate.
 *
 * 🔒 **THIS IS WHERE "FILTERED TWICE ON PURPOSE" STILL LIVES.** The aggregate
 * pushes {@link isWorkspaceSeatBurn} into SQL and returns sums, so it has no rows
 * for this belt to re-check — that is argued in the migration and pinned
 * textually by `usage-rails-row-cap.test.ts`. On THIS path the belt is applied, which
 * is why the fold is the only place rows become groups.
 */
function foldSeatBurns(
  scan: UsageScan<WorkspaceCreditEventRow>,
  workspaceId: string,
  channelIds: ReadonlySet<string>
): CreditRails {
  const rails: CreditRails = {
    channels: new Map(),
    people: new Map(),
    events: 0,
    truncated: scan.truncated,
  };
  for (const row of scan.rows) {
    if (!isWorkspaceSeatBurn(row, workspaceId, channelIds)) continue;
    rails.events += 1;
    if (row.channel_id) {
      rails.channels.set(
        row.channel_id,
        (rails.channels.get(row.channel_id) ?? 0) + row.amount
      );
    }
    if (row.user_id) {
      rails.people.set(
        row.user_id,
        (rails.people.get(row.user_id) ?? 0) + row.amount
      );
    }
  }
  return rails;
}

/**
 * THE CREDIT RAILS — grouped by Postgres, or folded from the capped scan.
 *
 * ⚠ **THE DEGRADE IS THE LIVE PATH UNTIL THE MIGRATION IS APPLIED**, so it is
 * not a theoretical arm: it answers the same shape, from the newest 1,000 rows
 * `max_rows` allows, and says `truncated` through the now-honest `clippedAt`.
 */
export async function readCreditRails(
  workspaceId: string,
  channelIds: readonly string[],
  sinceIso: string
): Promise<CreditRails> {
  const tally = await tallyWorkspaceCredits(workspaceId, channelIds, sinceIso);
  if (tally) {
    return {
      channels: keyedCredits(tally.channels),
      people: keyedCredits(tally.people),
      // ⚠ EITHER grouping set covers every matching row, so the channel
      // dimension's event total is the window's — `people` would answer the same
      // number and summing both would DOUBLE it.
      events: tally.channels.reduce((sum, row) => sum + row.events, 0),
      // ⚠ A MEASUREMENT, not optimism: at most `channels + members` rows come
      // back, so there is nothing for the ceiling to clip.
      truncated: false,
    };
  }
  return foldSeatBurns(
    await scanWorkspaceCreditEvents(workspaceId, channelIds, sinceIso),
    workspaceId,
    new Set(channelIds)
  );
}

/** The by-tool rail — counted by Postgres, or by folding the capped scan. */
export async function readToolRail(
  workspaceId: string,
  sinceIso: string
): Promise<ToolRail> {
  const tally = await tallyWorkspaceMcpTools(workspaceId, sinceIso);
  if (tally) {
    return {
      rows: tally,
      calls: tally.reduce((sum, row) => sum + row.calls, 0),
      truncated: false,
    };
  }
  const scan = await scanWorkspaceMcpCalls(workspaceId, sinceIso);
  const byPair = new Map<string, WorkspaceToolTallyRow>();
  for (const row of scan.rows) {
    const key = toolKey(row.tool, row.op);
    const found = byPair.get(key);
    if (found) found.calls += 1;
    else byPair.set(key, { tool: row.tool, op: row.op, calls: 1 });
  }
  return {
    rows: [...byPair.values()],
    calls: scan.rows.length,
    truncated: scan.truncated,
  };
}

/** The by-channel rail's message figure — counted by Postgres, or folded. */
export async function readMessageRail(
  workspaceId: string,
  sinceIso: string
): Promise<MessageRail> {
  const tally = await tallyWorkspaceChannelMessages(workspaceId, sinceIso);
  if (tally) {
    return {
      byChannel: tally,
      messages: [...tally.values()].reduce((sum, count) => sum + count, 0),
      truncated: false,
    };
  }
  const scan = await scanWorkspaceMessageChannels(workspaceId, sinceIso);
  const byChannel = new Map<string, number>();
  for (const row of scan.rows) {
    byChannel.set(row.channel_id, (byChannel.get(row.channel_id) ?? 0) + 1);
  }
  return {
    byChannel,
    messages: scan.rows.length,
    truncated: scan.truncated,
  };
}

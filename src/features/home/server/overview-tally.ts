import type { Role } from "@/features/workspaces/types";
import type {
  HomeAgentRow,
  HomeAttentionItem,
  HomeChannelUsage,
  HomePersonUsage,
  HomeThreadRow,
  HomeToolUsage,
} from "../overview-types";
import type {
  ConsentRequestRow,
  HeldSessionRow,
  MentionRow,
} from "./repository-attention";
import {
  roleKey,
  type CreditEventScanRow,
  type McpCallScanRow,
  type RunningSessionRow,
  type ThreadActivityRow,
} from "./repository-overview";

/**
 * The /home Overview face's PURE half — the tallies over scanned rows and the
 * two row→payload mappers.
 *
 * ⚠ SPLIT OUT OF `service-overview.ts` ON 2026-09-01, when the thread and agent
 * sections took that file past the 500-line cap (§1 —
 * `eslint.config.mjs › max-lines`). The seam is the one the file already had a
 * banner for: **nothing here does IO**, so it is unit-testable without a single
 * mock, and `service-overview.test.ts` covers this module almost entirely.
 *
 * ⚠ **NO `server-only` HERE, DELIBERATELY, AND IT IS STILL SERVER CODE.** It
 * imports row TYPES from the repository (types erase) and nothing that reaches a
 * client. The marker stays on `service-overview.ts` and on the repository, which
 * are the modules that actually touch `supabaseAdmin()`.
 */

/**
 * The six CLOSED situation keys `channel_sessions.detail` may carry.
 *
 * 🔒 **NARROWED ON THE WAY OUT, exactly as `collab-dto.ts ›
 * narrowSessionDetail` does it, and the column's own migration explains why the
 * DB deliberately does NOT `CHECK` this list**: a newer desktop shipping a
 * seventh key must be able to STORE it rather than 400 its whole push, so the
 * closed-value test belongs on the READ side. An unknown key renders as
 * nothing. ⚠ `detail` is the ONE peer-visible telemetry column and it is
 * peer-visible ONLY because this vocabulary is closed — if it ever becomes
 * free-form it becomes private in the same change.
 */
const SESSION_DETAILS: readonly string[] = [
  "thinking",
  "tool",
  "posting",
  "permission",
  "awaiting_peer",
  "awaiting_inbound",
];

export function narrowDetail(raw: string | null): string | null {
  return raw !== null && SESSION_DETAILS.includes(raw) ? raw : null;
}

/** How many `(tool, op)` rows the tools list carries. */
const TOOL_ROWS = 8;

/** How many people the by-person list carries. ⚠ A ceiling on the RENDER, not
 *  on the tally, and the scan denominator travels with it (`scanned`). */
const PERSON_ROWS = 8;

/** How many channels the per-channel comparison carries. */
const CHANNEL_ROWS = 8;

/** Tool + op, as one map key. A tool with no op (`op` defaults to `''`) keys
 *  on the tool alone rather than on a trailing separator. */
function toolKey(tool: string, op: string): string {
  return op ? `${tool}:${op}` : tool;
}

/**
 * `(tool, op)` pairs by call count, descending, capped at {@link TOOL_ROWS}.
 *
 * ⚠ TIES BREAK ON THE KEY, so the list is TOTALLY ordered and does not shuffle
 * between two loads that measured the same numbers.
 */
export function tallyTools(rows: McpCallScanRow[]): HomeToolUsage[] {
  const byPair = new Map<string, HomeToolUsage>();
  for (const row of rows) {
    const key = toolKey(row.tool, row.op);
    const found = byPair.get(key);
    if (found) found.calls += 1;
    else byPair.set(key, { tool: row.tool, op: row.op, calls: 1 });
  }
  return [...byPair.values()]
    .sort(
      (a, b) =>
        b.calls - a.calls ||
        toolKey(a.tool, a.op).localeCompare(toolKey(b.tool, b.op))
    )
    .slice(0, TOOL_ROWS);
}

/**
 * CREDITS per PERSON, descending — the guest breakdown Samuel asked for, now on
 * what was actually CHARGED rather than on loopback-request shape.
 *
 * ⚠ **IT TALLIED `mcp_tool_calls` UNTIL 2026-09-01.** That table counts loopback
 * REQUESTS — `dopl_map` fans out, the await ops poll — so it was never a cost,
 * and `credits.ts` says so from the other side. It now sums the
 * `credit_usage_events` ledger. ⚠ Which means the figure is a FLOOR: the
 * ledger's writer is fire-and-forget and this scan is capped.
 *
 * ⚠ **A ROW WITH NO `user_id` IS DROPPED, NOT BUCKETED AS "UNKNOWN".** The
 * column is `ON DELETE SET NULL`, so a null means the account is GONE — there is
 * nobody to attribute the spend to, and an "Unknown" row in a per-person
 * breakdown reads as a person.
 *
 * ⚠ `role` is looked up per (container, user) and the FIRST one found wins — a
 * person can be a guest in one home channel and a member of another, and an
 * account-wide list has no honest way to print two. ⚠ A row whose
 * `origin_workspace_id` is null (the container was deleted) can still be
 * attributed to a PERSON, so it counts here with a `null` role rather than being
 * dropped: the spend happened and somebody made it.
 */
export function tallyCreditPeople(
  rows: CreditEventScanRow[],
  roles: Map<string, Role>,
  names: Map<string, string>
): HomePersonUsage[] {
  const byUser = new Map<string, HomePersonUsage>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const roleForRow = row.origin_workspace_id
      ? (roles.get(roleKey(row.origin_workspace_id, row.user_id)) ?? null)
      : null;
    const found = byUser.get(row.user_id);
    if (found) {
      found.credits += row.amount;
      if (found.role === null) found.role = roleForRow;
      continue;
    }
    byUser.set(row.user_id, {
      userId: row.user_id,
      name: names.get(row.user_id) ?? "",
      role: roleForRow,
      credits: row.amount,
    });
  }
  return [...byUser.values()]
    .sort((a, b) => b.credits - a.credits || a.userId.localeCompare(b.userId))
    .slice(0, PERSON_ROWS);
}

/**
 * CREDITS and MESSAGES per home channel, descending by credits.
 *
 * ⚠ **THE CREDIT DIMENSION IS `origin_workspace_id`**, the container the call
 * was made in — never the ledger's `workspace_id`, which is the PAYER and for a
 * home container is the owner's billing workspace
 * (`repository-overview.ts › scanCreditEvents` states the fence).
 *
 * ⚠ EVERY CHANNEL IN THE FENCE GETS A ROW, including the silent ones — the
 * comparison is "which of MY channels is busy", and dropping the quiet ones
 * turns an answer of "none of them" into an empty list that reads as a failed
 * read. The RENDER cap is {@link CHANNEL_ROWS}.
 */
export function tallyChannels(
  names: Map<string, string>,
  credits: CreditEventScanRow[],
  messages: Array<{ workspace_id: string }>
): HomeChannelUsage[] {
  const rows = new Map<string, HomeChannelUsage>();
  for (const [workspaceId, name] of names) {
    rows.set(workspaceId, { workspaceId, name, credits: 0, messages: 0 });
  }
  for (const event of credits) {
    const row = event.origin_workspace_id
      ? rows.get(event.origin_workspace_id)
      : undefined;
    if (row) row.credits += event.amount;
  }
  for (const message of messages) {
    const row = rows.get(message.workspace_id);
    if (row) row.messages += 1;
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        b.credits - a.credits ||
        b.messages - a.messages ||
        a.name.localeCompare(b.name)
    )
    .slice(0, CHANNEL_ROWS);
}

/** One line on an attention row. ⚠ Clipped HERE, on the server: a mention body
 *  is arbitrary user text and the panel renders one line. */
const ATTENTION_TITLE_MAX = 120;

function oneLine(raw: string, fallback: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return fallback;
  return flat.length > ATTENTION_TITLE_MAX
    ? `${flat.slice(0, ATTENTION_TITLE_MAX - 1)}…`
    : flat;
}

/**
 * The three attention lanes → ONE ordered list.
 *
 * ⚠ **ORDER IS BY KIND FIRST, RECENCY SECOND, AND THAT IS A JUDGEMENT ABOUT
 * URGENCY rather than about time.** A consent request is an agent STOPPED
 * waiting for a decision; a permission hold is the same thing one layer down; a
 * mention is a message somebody has not read. Sorting the three purely by
 * timestamp would bury a blocked agent under an hour-old @-mention.
 *
 * ⚠ THE CHANNEL NAME COMES FROM THE FENCE'S MAP, not from any of the three rows
 * — none of them carries one, and the panel is cross-channel so it has to say
 * WHERE.
 */
export function mapAttention(
  consent: ConsentRequestRow[],
  held: HeldSessionRow[],
  mentions: MentionRow[],
  names: Map<string, string>,
  limit: number
): HomeAttentionItem[] {
  const channelName = (workspaceId: string) => names.get(workspaceId) ?? "";
  const items: HomeAttentionItem[] = [
    ...consent.map((row) => ({
      id: `consent:${row.id}`,
      kind: "consent" as const,
      workspaceId: row.workspace_id,
      channelName: channelName(row.workspace_id),
      title: oneLine(row.summary, "Agent wants to send a message"),
      // ⚠ NO THREAD: `channel_consent_requests` carries a channel, not a task.
      threadId: null,
      at: row.created_at,
    })),
    ...held.map((row) => ({
      id: `permission:${row.id}`,
      kind: "permission" as const,
      workspaceId: row.workspace_id,
      channelName: channelName(row.workspace_id),
      // The agent's own handle is the useful noun — the operator is being asked
      // to unblock a named agent, not an abstract session.
      title: oneLine(
        row.display_name || row.name,
        "An agent is waiting on permission"
      ),
      threadId: row.task_id,
      at: row.updated_at,
    })),
    ...mentions.map((row) => ({
      id: `mention:${row.id}`,
      kind: "mention" as const,
      workspaceId: row.workspace_id,
      channelName: channelName(row.workspace_id),
      title: oneLine(row.body, "Mentioned you"),
      // ⚠ ALWAYS NULL — `channel_messages` has no `task_id` column, so the jump
      // opens the channel. Inventing one would land the operator in a thread the
      // message is not in.
      threadId: null,
      at: row.created_at,
    })),
  ];
  const rank: Record<HomeAttentionItem["kind"], number> = {
    consent: 0,
    permission: 1,
    mention: 2,
  };
  return items
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.at.localeCompare(a.at))
    .slice(0, limit);
}

/**
 * Rows → the thread section's shape.
 *
 * ⚠ THE CHANNEL NAME COMES FROM THE FENCE'S MAP, not from the row: a thread
 * carries no channel name, and the cross-channel list has to say WHERE without
 * a second read.
 */
export function mapThreads(
  rows: ThreadActivityRow[],
  names: Map<string, string>
): HomeThreadRow[] {
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    channelName: names.get(row.workspace_id) ?? "",
    title: row.title,
    status: row.status,
    lastActivityAt: row.last_activity_at,
  }));
}

/**
 * Rows → the agent section's shape.
 *
 * 🔒 **CONSTRUCTED, NOT SPREAD — the same discipline `collab-dto.ts ›
 * mapPeerSessionStateRow` states.** Naming each field means a column added to
 * `channel_sessions` (including a new OPERATOR-ONLY one) cannot reach this
 * payload by accident; an omit-list would fail OPEN.
 *
 * ⚠ `mine` REPLACES THE `user_id`, and that is the privacy shape: the caller
 * needs to tell their own agents from a peer's, and does not need the peer's id
 * to do it. ⚠ `channel_sessions.display_name` is preferred over `name` because
 * it is what the operator renamed the agent to.
 */
export function mapAgents(
  rows: RunningSessionRow[],
  names: Map<string, string>,
  viewerId: string
): HomeAgentRow[] {
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    // The container's own channel name is authoritative; the denormalised
    // `channel_name` on the session can lag a rename.
    channelName: names.get(row.workspace_id) ?? row.channel_name ?? "",
    name: row.display_name || row.name,
    state: row.state,
    detail: narrowDetail(row.detail),
    // ⚠ THE ID AND THE TITLE ARE TWO DIFFERENT ANSWERS AND BOTH RIDE. The title
    // is what the row PRINTS; the id is where clicking it LANDS, and a session
    // launched at channel level has neither.
    threadId: row.task_id,
    threadTitle: row.thread_title,
    mine: row.user_id === viewerId,
    updatedAt: row.updated_at,
  }));
}

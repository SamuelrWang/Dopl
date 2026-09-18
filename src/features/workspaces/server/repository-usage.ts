import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "../types";

/**
 * DATA ACCESS FOR THE WORKSPACE OVERVIEW'S WAVE-8 PANELS — the credit ledger,
 * the MCP tool scan, the live agent board and this container's token spend.
 *
 * ⚠ **ITS OWN FILE BESIDE `repository-overview.ts`, NOT A WIDENING OF IT.**
 * That module is at 334 lines (measured 2026-09-17) against the 500-line cap
 * (§1), and these reads have a different fence story: the counts there are
 * workspace-wide aggregates, and two of the four here are fenced on a PERSON.
 *
 * ⚠ **EVERY FUNCTION TAKES `workspaceId` FROM `segment.ts › resolveApiWorkspace`
 * AND NOTHING A CALLER SENT.** These run on the service-role admin client, which
 * BYPASSES RLS (§2), so the argument list IS the fence.
 *
 * ⚠ THE ADMIN CLIENT IS UNTYPED HERE for the reason `repository-overview.ts`
 * gives: the generated `Database` type does not carry the channels tables, nor
 * `credit_usage_events`, nor `workspace_token_spend`.
 */

/**
 * Ceiling on a breakdown SCAN. ⚠ A scan AT its ceiling is indistinguishable
 * from an exhausted one, so every caller returns `truncated` beside the rows
 * and the surface says so (§9). Ordered NEWEST FIRST so a clip NARROWS the
 * window the shares describe rather than inventing a zero for an old bin.
 *
 * ⚠ **HALF `HOME_SCAN_LIMIT` (20,000) ON PURPOSE.** /home's scan spans every
 * container one person belongs to; this one spans one container's whole
 * membership, and the page gates on it.
 */
export const WORKSPACE_SCAN_LIMIT = 10_000;

/** A scan that came back AT its ceiling is a FLOOR, and says so. */
export interface UsageScan<T> {
  rows: T[];
  truncated: boolean;
}

function clipped<T>(rows: T[], limit: number): UsageScan<T> {
  return { rows, truncated: rows.length >= limit };
}

/**
 * De Morgan of `NOT (tool = 'channel' AND op LIKE 'await%')`.
 *
 * ⚠ **THE SENTENCE IS SHARED, THE CONSTANT IS NOT** — the same trade
 * `home/server/repository-overview.ts › EXCLUDE_AWAIT_POLLING` records: two
 * features cannot share a module without one importing the other's repository
 * (§2 forbids it). `dopl_channel`'s await ops POLL, and unfiltered they dominate
 * every tool rail this page draws.
 */
const EXCLUDE_AWAIT_POLLING = "tool.neq.channel,op.not.like.await*";

/** The wallets a STANDARD workspace's own spend can sit on: the v2.1 per-member
 *  `seat`, and the LEGACY pooled `workspace` (the column's `DEFAULT`, every row
 *  written before 2026-09-07). ⚠ `personal` is neither, and its absence is the
 *  whole fence — see {@link scanWorkspaceCreditEvents}. */
const WORKSPACE_WALLETS = ["seat", "workspace"];

export interface WorkspaceCreditEventRow {
  origin_workspace_id: string | null;
  user_id: string | null;
  /** WHICH COUNTER MOVED — `seat` | `workspace` here by construction. Read
   *  because it is half the predicate the service re-applies. */
  wallet: string;
  /** RULE B's dimension: the CALLING CHANNEL that was billed, `null` for a
   *  channel-less call ("Desktop agent") and for every pre-2026-09-13 row. */
  channel_id: string | null;
  amount: number;
  created_at: string;
}

/**
 * THE CREDIT LEDGER, fenced to the rows THIS WORKSPACE'S SEAT WALLETS PAID FOR.
 *
 * 🔒 **THE FENCE IS TWO ARMS UNDER ONE WALLET FILTER, AND IT IS
 * `docs/specs/credit-model-v2.md` §3 + RULE B READ BACKWARDS.**
 *   1. `channel_id IN (this workspace's channels)` — rule B arm 2: a
 *      workspace-channel agent charges the CALLER'S SEAT in that workspace
 *      whatever it touches, so a burn against somebody's personal KB is still
 *      this workspace's bill and its `origin_workspace_id` is NOT this
 *      workspace. The channel is the only column that says so.
 *   2. `origin_workspace_id = this workspace` — rule B arm 3, the channel-less
 *      call on a workspace resource ("Desktop agent"), plus every legacy pooled
 *      row, neither of which has a channel at all.
 * ⚠ **AND `wallet IN ('seat','workspace')` OVER BOTH.** A `personal` row
 * addressed at this workspace is a HOME channel's agent reaching in — rule B arm
 * 1, the channel owner's wallet — and it is on no workspace figure. **A personal
 * figure and a seat figure must never be summed** (the 2026-09-12 bug,
 * credit-model-v2 §3 "Surfaces"), which is why the wallet filter is an AND over
 * the union rather than a third arm beside it.
 *
 * ⚠ **THE CHANNEL LIST IS UNFENCED BY VISIBILITY AND THE RAIL IS NOT.** These
 * rows are AMOUNTS and carry no content, so the series, the by-person rail and
 * the by-tool rail are workspace-wide aggregates — the posture
 * `service-overview.ts` already states for counts. The by-CHANNEL rail prints a
 * NAME, so `service-usage.ts` drops rows whose channel the caller cannot see.
 *
 * ⚠ **A SUM WITH NO `SUM`.** PostgREST cannot aggregate, so this hauls the
 * window and the service adds it up — the sanctioned haul-and-tally shape (§9),
 * with `truncated` travelling beside the shares.
 *
 * ⚠ **IT DEGRADES TO EMPTY RATHER THAN THROWING, and only this read does.**
 * `credit_usage_events` and its `wallet` / `channel_id` columns ship as
 * UNAPPLIED migrations (`20260901130000`, `20260930120000`, `20261003120000`),
 * so between deploy and apply PostgREST answers `42P01` / `42703` — and this
 * read sits in the Overview payload's `Promise.all`, where a throw 500s every
 * panel on the page. An empty ledger is an expected reading here anyway (the
 * table starts with no history), which is what makes the degrade honest. ⚠
 * LOGGED, never silent.
 */
export async function scanWorkspaceCreditEvents(
  workspaceId: string,
  channelIds: readonly string[],
  sinceIso: string,
  opts: { untilIso?: string; limit?: number; channelId?: string | null } = {}
): Promise<UsageScan<WorkspaceCreditEventRow>> {
  const limit = opts.limit ?? WORKSPACE_SCAN_LIMIT;
  // ⚠ PostgREST has no syntax for an empty `in.()`, so the channel arm is
  // dropped rather than spelled empty — a workspace with no channels still has
  // an honest answer through the origin arm.
  const channelArm =
    channelIds.length > 0 ? `,channel_id.in.(${channelIds.join(",")})` : "";
  let query = supabaseAdmin()
    .from("credit_usage_events")
    .select("origin_workspace_id, user_id, wallet, channel_id, amount, created_at")
    .in("wallet", WORKSPACE_WALLETS)
    .or(`origin_workspace_id.eq.${workspaceId}${channelArm}`)
    .gte("created_at", sinceIso);
  if (opts.untilIso) query = query.lt("created_at", opts.untilIso);
  // ⚠ A NARROWING INSIDE THE FENCE ABOVE, never a fence of its own — PostgREST
  // composes this as a conjunction, so the wallet + container arms still decide
  // which rows EXIST and this only hides some of them. The caller proved the
  // channel is visible first (`service-overview.ts › isChannelVisibleTo`).
  if (opts.channelId) query = query.eq("channel_id", opts.channelId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(
      `[workspaces/overview] credit ledger unreadable, degrading to empty: ${error.message}`
    );
    return { rows: [], truncated: false };
  }
  return clipped((data ?? []) as WorkspaceCreditEventRow[], limit);
}

export interface WorkspaceToolCallRow {
  tool: string;
  op: string;
}

/** The window's MCP calls in this workspace, for the tool rail. ⚠ TWO COLUMNS:
 *  this read exists to be COUNTED BY GROUP, and every other column would put
 *  something on the wire that never renders (§9). */
export async function scanWorkspaceMcpCalls(
  workspaceId: string,
  sinceIso: string,
  limit: number = WORKSPACE_SCAN_LIMIT
): Promise<UsageScan<WorkspaceToolCallRow>> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_tool_calls")
    .select("tool, op")
    .eq("workspace_id", workspaceId)
    .gte("created_at", sinceIso)
    .or(EXCLUDE_AWAIT_POLLING)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as WorkspaceToolCallRow[], limit);
}

/** Which channel each message in the window landed in. ⚠ ONE COLUMN, same rule
 *  as {@link scanWorkspaceMcpCalls}. */
export async function scanWorkspaceMessageChannels(
  workspaceId: string,
  sinceIso: string,
  limit: number = WORKSPACE_SCAN_LIMIT
): Promise<UsageScan<{ channel_id: string }>> {
  const { data, error } = await supabaseAdmin()
    .from("channel_messages")
    .select("channel_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "message")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as Array<{ channel_id: string }>, limit);
}

/** Every channel id in the container — the credit scan's rule-B arm. ⚠ IDS
 *  ONLY: it fences a read, it never reaches a render, so a NAME here would be
 *  content crossing a fence it was not checked against. */
export async function listWorkspaceChannelIds(
  workspaceId: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export interface WorkspaceSessionRow {
  id: string;
  channel_id: string | null;
  user_id: string;
  task_id: string | null;
  name: string;
  display_name: string | null;
  state: string;
  detail: string | null;
  channel_name: string | null;
  thread_title: string | null;
  updated_at: string;
}

/**
 * EVERYONE'S LIVE agent sessions in this container, newest activity first
 * (R-25, ruled 2026-09-17: every member's LIVE agent is listed and an ENDED one
 * is not).
 *
 * 🔒 **PUBLIC COLUMNS ONLY — NOT ONE OF THE SEVEN OPERATOR-ONLY ONES.** Drawn
 * from the PUBLIC half of `20260822150000_channel_sessions_telemetry.sql`:
 * identity, whose machine, state, the closed-vocabulary `detail`, the two names
 * and the timestamps. **`model`, `tool_label`, `context_used`, `context_window`,
 * `tokens_spent`, `started_at` and `last_activity_at` are absent and must stay
 * absent.** This runs service-role, so neither RLS nor the column GRANT applies
 * and the DTO fence (`collab-dto.ts › mapPeerSessionStateRow`) is not on this
 * path — **the column list IS the fence**, and it fails closed by naming what
 * may be read rather than omitting what may not.
 */
export async function listWorkspaceRunningSessions(
  workspaceId: string,
  limit: number
): Promise<UsageScan<WorkspaceSessionRow>> {
  const { data, error } = await supabaseAdmin()
    .from("channel_sessions")
    .select(
      "id, channel_id, user_id, task_id, name, display_name, state, detail, channel_name, thread_title, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .neq("state", "ended")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return clipped((data ?? []) as WorkspaceSessionRow[], limit);
}

/** `userId → role` for this container — the guest/member split the person rail
 *  marks. ⚠ `workspace_members` is the ONLY table where `guest` exists. */
export async function listWorkspaceRoles(
  workspaceId: string
): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ user_id: string; role: Role }>) {
    out.set(row.user_id, row.role);
  }
  return out;
}

/** How many runs the token-spend read carries. */
const TOKEN_SPEND_LIMIT = 2_000;

/**
 * THE CALLER'S OWN TOKEN SPEND IN THIS CONTAINER, newest run first.
 *
 * 🔒 **BOTH FENCES, AND THE `user_id` ONE IS NOT NEGOTIABLE.**
 * `workspace_token_spend` is RLS-deny-all and per-OPERATOR by design — its own
 * migration refuses a member-scoped read policy in as many words: *"a
 * member-scoped read policy would let any workspace member read how many tokens
 * a colleague's agents burned, which nobody has ruled"*. R-29's privacy half
 * left that standing, so this read adds the CONTAINER fence and keeps the
 * operator one. **There is no workspace-wide variant of this function and there
 * must not be one** — see INVARIANTS §9.
 *
 * ⚠ A MISSING LEDGER DEGRADES TO AN EMPTY LIST: an absent ledger and an empty
 * one both mean "no spend is recorded for you here", so the answer is honest
 * either way.
 */
export async function listWorkspaceTokenSpend(
  workspaceId: string,
  userId: string,
  sinceIso: string
): Promise<UsageScan<{ started_at: string; tokens: number }>> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_token_spend")
    .select("started_at, tokens")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(TOKEN_SPEND_LIMIT);
  if (error) {
    console.warn(
      `[workspaces/overview] token ledger unreadable, degrading to empty: ${error.message}`
    );
    return { rows: [], truncated: false };
  }
  return clipped(
    (data ?? []) as Array<{ started_at: string; tokens: number }>,
    TOKEN_SPEND_LIMIT
  );
}

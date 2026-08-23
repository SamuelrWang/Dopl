import "server-only";
import type { SessionStateEntryInput } from "../schema-sessions";
import type { ChannelSessionState, ChannelSessionStateOwn } from "../types";
import {
  mapOwnSessionStateRow,
  mapPeerSessionStateRow,
  type SessionStateUpsert,
} from "./collab-dto";
import * as collab from "./repository-collab";
import * as sessionRepo from "./repository-sessions";
import type { ChannelContext } from "./service-shared";
import { loadVisibleChannel } from "./service-shared";

/**
 * THE OWN-SCOPED SESSION READ'S WHOLE ANSWER — the rows, AND whether the machine
 * that would have written them is still there (2026-08-23, F-294).
 *
 * ⚠ **THE SECOND FIELD EXISTS BECAUSE THE FIRST ONE CANNOT ANSWER "IS IT ALIVE".**
 * `channel_sessions` is pushed on state CHANGE, so an idle-but-alive agent and a
 * crashed desktop produce the SAME quiet row, and the MCP render had to hedge
 * both as "may be offline" — a lie about the idle one, told within ~2 minutes.
 * `agent_presence` DOES beat unconditionally (~120/hr, `main/presence.js`), so
 * joining it here separates the two without touching the push contract and
 * without a single new write. ⚠ **The renderer must never re-derive freshness
 * from a stamp of its own** — see the boolean note in {@link listSessionStates}.
 * ⚠ **IT IS PER-(USER, WORKSPACE), NOT PER-MACHINE**, exactly like the
 * `launch_agent` pre-check (`service-launch.ts › operatorIsOnline`), so it can
 * only ever soften a hedge into "unchanged" and never harden one into a claim.
 */
export interface OwnSessionsReport {
  sessions: ChannelSessionStateOwn[];
  /** ⚠ `false` covers no row, no stamp and an unreadable stamp alike. The
   *  "not reported" case is the WIRE KEY being absent, which is the routes'
   *  fail-soft branch — never a `false` here. */
  operatorOnline: boolean;
}

/**
 * SESSION-STATE SERVICE — the read half of "what is flint doing?" over MCP. A
 * SESSION is the only agent identity there is, and its live state lives in the
 * DESKTOP main process. This reads the projection the desktop pushes to
 * `channel_sessions` and returns the {@link ChannelSessionState} shape the MCP
 * op renders. ⚠ The SAME derivation the pills show — the server stores and
 * returns, and adds no second derivation.
 *
 * ⚠ TWO READS, TWO SCOPES (2026-08-20): {@link listSessionStates} stays scoped
 * to the CALLER (`ctx.userId`) — "what are MY agents doing" — while
 * {@link listChannelSessions} is CHANNEL-scoped for the Agents tab's peer
 * cards, fenced by `loadVisibleChannel` — ⚠ which admits a PUBLIC channel's
 * non-member readers (§5's channel-visible rule); the member SELECT policy
 * (20260820200000) is the PostgREST belt, not this admin-client path's fence.
 *
 * ⚠ **AND SINCE 2026-08-22 THE TWO SCOPES CARRY TWO SHAPES** (Samuel: telemetry
 * is OPERATOR-ONLY, peers keep coarse). The row got seven operator-only columns
 * — model, current tool, context used/window, tokens, started/last-activity —
 * and **THIS SERVICE IS WHERE THE SPLIT IS ENFORCED**, because both reads run on
 * the RLS- and grant-bypassing admin client and neither RLS nor the column
 * GRANT can see them. The mechanism is two mappers with two return types
 * (`collab-dto.ts › mapOwnSessionStateRow` / `mapPeerSessionStateRow`) and NO
 * default audience: a call site must name whose eyes it renders for, and TypeScript
 * refuses a peer surface that assigns the rich shape. The GRANT in migration
 * `20260822150000` is the belt for the PostgREST/CDC doors this path never uses.
 *
 * Delivery is PUSH ON STATE CHANGE ({@link reportSessionStates}, called by
 * `main/session-state-push.js`), never a heartbeat. An empty answer is reported
 * honestly as "no live sessions", never as a claim about the caller's machine —
 * see `listSessionStates` for the one PostgREST code degraded to `[]`.
 */
export async function listSessionStates(
  ctx: ChannelContext,
  channelId?: string
): Promise<OwnSessionsReport> {
  // ⚠ **CONCURRENT, AND BOTH READS ARE THE CALLER'S OWN.** The presence lookup is
  // a PK hit on a tiny table (`repository-collab.ts › presenceForUser`), so this
  // adds latency only if it is serialized behind the session read — which on the
  // await route would be one extra round trip on the one path the feature's whole
  // egress budget is written around.
  const [rows, presence] = await Promise.all([
    sessionRepo.listSessionStates(ctx.userId, ctx.workspaceId, channelId),
    collab.presenceForUser(ctx.userId, ctx.workspaceId),
  ]);
  return {
    // ⚠ THE OWN MAPPER, and the licence for it is the `ctx.userId` fence one line
    // up — not this function's name. Every row here belongs to the caller's own
    // machine, which is the only condition under which telemetry may be rendered.
    sessions: rows.map(mapOwnSessionStateRow),
    // ⚠ A BOOLEAN, NOT THE STAMP. The stamp is the operator's own so nothing
    // leaks, but it is also a second liveness number on the wire that a client
    // could re-derive against a window of its own — which is exactly the drift
    // `SESSION_STALE_WINDOW_MS`'s duplicate-plus-pin exists to prevent. The
    // SERVER owns the window; the wire carries the answer.
    operatorOnline: presence?.online === true,
  };
}

/**
 * EVERY member's sessions in ONE channel — the Agents tab's PEER CARDS
 * (Samuel, 2026-08-20). ⚠ NOT caller-scoped, and that is deliberate and
 * bounded: the reader must be able to READ the channel (`loadVisibleChannel`,
 * the same fence every channel read uses), and what comes back is the COARSE
 * projection alone.
 *
 * ⚠ **ITS DOCBLOCK USED TO SAY "no transcript, no tools, no tokens EXIST IN THE
 * TABLE to leak", AND THAT SENTENCE EXPIRED ON 2026-08-22.** They exist now
 * (migration `20260822150000`). The absence of a thing to leak was doing the
 * security work, and the replacement for it is {@link mapPeerSessionStateRow},
 * which cannot emit them because it never names them. ⚠ Do not "simplify" this
 * to spreading the row: the read is deliberately `select("*")`, so the wide row
 * IS in memory here and only the mapper stands between it and a peer.
 *
 * ⚠ THE READER MAY BE A NON-MEMBER of a PUBLIC channel — that is §5's rule and
 * this fence inherits it, which is a second reason the projection is coarse.
 */
export async function listChannelSessions(
  ctx: ChannelContext,
  ref: string
): Promise<Array<ChannelSessionState & { userId: string }>> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await sessionRepo.listChannelSessionStates(
    ctx.workspaceId,
    channel.id
  );
  // ⚠ `userId` rides so the card can wear its owner's avatar. It is the ONE
  // field added on top of the coarse projection, and it is an identity the
  // roster already publishes — not a fact about the machine.
  return rows.map((row) => ({
    ...mapPeerSessionStateRow(row),
    userId: row.user_id,
  }));
}

/** API shape → column shape. ⚠ The one place the two vocabularies meet, and
 *  where `undefined` becomes the `null` the column stores — the schema lets a
 *  field be absent, the database has no such value.
 *
 *  ⚠ `?? null` ON EVERY TELEMETRY FIELD, AND NEVER `?? 0`. An older desktop
 *  omits the key; the column then stores NULL, which the read renders as
 *  "unknown". Defaulting a count to 0 here would manufacture a measurement
 *  nobody took, and it would do it in the one place where the absence is still
 *  visible. */
function toUpsert(entry: SessionStateEntryInput): SessionStateUpsert {
  return {
    session_key: entry.sessionKey,
    channel_id: entry.channelId,
    task_id: entry.threadId ?? null,
    name: entry.name,
    state: entry.state,
    channel_name: entry.channelName ?? null,
    thread_title: entry.threadTitle ?? null,
    detail: entry.detail ?? null,
    tool_label: entry.toolLabel ?? null,
    model: entry.model ?? null,
    context_used: entry.contextUsed ?? null,
    context_window: entry.contextWindow ?? null,
    tokens_spent: entry.tokensSpent ?? null,
    started_at: entry.startedAt ?? null,
    last_activity_at: entry.lastActivityAt ?? null,
    // ⚠ `?? null` for the same reason, and one more: absent and `null` are both
    // "no template to report" here, so nothing is lost by collapsing them — see
    // the column comment in `20260823130000`. Do NOT try to distinguish a
    // desktop that predates the field from a blank launch; only the DIRECTIVE
    // lane needs that distinction (spec E-4) and it is a different table.
    template_name: entry.templateName ?? null,
  };
}

/**
 * THE WRITE HALF — the operator's desktop reporting its whole live session set
 * for one workspace.
 *
 * ⚠ PUSH ON STATE CHANGE, NOT A HEARTBEAT: called only when
 * `session-summary.js`'s digest actually moves — a handful of writes per session
 * lifetime, against `agent_presence`'s 120/hour per listener. That difference is
 * the entire reason this table exists rather than a column on the presence row.
 *
 * ⚠ SCOPED TO THE CALLER, exactly as the read is. `ctx.userId` /
 * `ctx.workspaceId` are the only identity the repository sees; the payload
 * carries neither, so a caller cannot write a row answering someone else's
 * `read_sessions`. Membership floor is `withWorkspaceAuth`'s (viewer), and
 * `channel_child_workspace_guard` refuses a channel from another workspace.
 *
 * ⚠ NO CREDENTIAL BOUND, deliberately: the rows are the caller's own and only
 * the caller reads them, so narrowing to a runtime stamp or cookie session
 * refuses a future desktop lane and buys no boundary. The bound is the identity
 * pair plus token custody.
 */
export async function reportSessionStates(
  ctx: ChannelContext,
  sessions: SessionStateEntryInput[]
): Promise<{ stored: number; changed: number; removed: number }> {
  return sessionRepo.replaceSessionStates(
    ctx.userId,
    ctx.workspaceId,
    sessions.map(toUpsert)
  );
}

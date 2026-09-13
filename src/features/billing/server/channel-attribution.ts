import "server-only";
import { findMembership } from "@/features/workspaces/server/repository";
import type { WorkspaceKind } from "@/features/workspaces/types";
import {
  findChannelContainer,
  type ChannelContainer,
} from "./channel-container";

/**
 * WHICH CHANNEL IS MAKING THIS CALL, AND MAY WE BILL ITS CONTAINER FOR IT —
 * RULE B's first half (Samuel, 2026-09-13).
 *
 * > "The wallet needs to match the histogram. That's the whole point." — charge
 * > the CALLING CHANNEL's container; with no calling channel, charge the
 * > RESOURCE's container.
 *
 * ⚠ **ITS OWN MODULE BECAUSE IT ASKS A DIFFERENT QUESTION FROM ITS CALLER, AND
 * BECAUSE `credits-service.ts` HAD NO ROOM** (§1's "split, do not squeeze": that
 * file measured 490 lines the day this landed — ⚠ `wc -l`, do not quote). That
 * file answers WHICH WALLET a container's burn lands on; this one answers WHICH
 * CONTAINER the burn belongs to in the first place, which is a question about the
 * CALLER's session rather than about the addressed resource.
 *
 * 🔒 **THE CHANNEL ARRIVES ON A FORGEABLE HEADER, SO THE FENCE IS THE WHOLE
 * POINT OF THIS FILE.** The id comes from `X-Dopl-Session-Id`'s
 * `<channelId>:<tail>` head — a documented NON-authorization signal that any
 * device-token holder can set to any value (`shared/auth/session-header.ts`,
 * INVARIANTS §10). Under rule B it decides WHOSE WALLET MOVES, which is the first
 * time that header has been allowed anywhere near a decision with a cost. So it
 * is honoured only when the caller is an ACTIVE MEMBER of the channel's
 * container, and otherwise IGNORED (never refused — this path fails open).
 *
 * ⚠ **THE SAME DIRECTION-OF-TRAVEL ARGUMENT `knowledge/server/service-audience.ts
 * › narrowToSessionChannel` MAKES, applied to a bill instead of a read.** There
 * the header may only narrow inside an already-fenced set; here it may only
 * select a container the caller could already have addressed. The worst a forged
 * value achieves is charging a container the forger is a member of — and in a
 * home channel that is the OWNER's wallet, which is Samuel's 2026-08-26 ruling
 * unchanged ("charge MCP calls from a guest to the user"), not a new exposure.
 * Without the fence, any account could have drained a stranger's personal wallet
 * by naming their channel.
 */

/** The channel a call is attributed to, and the container its wallet belongs to. */
export type CallingChannel = ChannelContainer;

/**
 * The calling channel, or `null` for "no calling channel" — which is rule B's
 * own fallback (charge the resource's container), and what every channel-less
 * caller looks like: a Claude Desktop or Claude Code MCP connection, an app
 * click, an older desktop build.
 *
 * ⚠ **ROUND TRIPS: 0 with no claimed channel, 1 in the ordinary case, 2 when the
 * call reaches ACROSS containers.** This runs once per MCP tool call, so the
 * split matters:
 *   * no `caller.channelId` → nothing is read at all. Every non-desktop client
 *     and every app click lands here, and the credit path costs exactly what it
 *     did before rule B.
 *   * the channel's container IS the addressed one (an agent working in its own
 *     channel — the common case) → ONE read, the channel row. **No membership
 *     read: `withWorkspaceAuth` already proved it**, and its kind is already on
 *     the auth context, so asking again would be paying for two answers we hold.
 *   * the channel's container is ANOTHER one (a home-channel agent reading a
 *     workspace KB — the case rule B exists for) → TWO reads, the channel row and
 *     the membership row that fences it.
 *
 * ⚠ **A CLAIM WE DROP IS LOGGED, NEVER SILENT.** Both drops mean somebody's
 * credits went somewhere other than where the session said, and a wallet moving
 * for unstated reasons is the one thing this path may not do quietly (the same
 * honesty rule `consumeMcpCredits`' unmetered warning states).
 */
export async function resolveCallingChannel(
  caller: {
    userId: string;
    channelId?: string | null;
    workspaceKind?: WorkspaceKind;
  },
  addressedWorkspaceId: string
): Promise<CallingChannel | null> {
  if (!caller.channelId) return null;
  const channel = await findChannelContainer(caller.channelId);
  if (!channel) {
    console.warn(
      `[credits] session claimed channel ${caller.channelId}, which resolves to no channel; ` +
        `charging the addressed container ${addressedWorkspaceId} instead`
    );
    return null;
  }
  if (channel.workspaceId === addressedWorkspaceId) {
    // ⚠ THE AUTH CONTEXT'S KIND WINS over the embedded one: same row, and it is
    // the value every other decision on this request was made with. The embedded
    // kind is the fallback for the cross-container arm below.
    return { ...channel, kind: caller.workspaceKind ?? channel.kind };
  }
  const membership = await findMembership(channel.workspaceId, caller.userId);
  // `findMembership` filters `status='active'`, so a row IS an active membership.
  if (!membership) {
    console.warn(
      `[credits] user ${caller.userId} claimed channel ${caller.channelId} in container ` +
        `${channel.workspaceId} they are not an active member of; ignoring the claim and ` +
        `charging the addressed container ${addressedWorkspaceId}`
    );
    return null;
  }
  return channel;
}

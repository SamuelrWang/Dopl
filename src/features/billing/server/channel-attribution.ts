import "server-only";
import { findMembership } from "@/features/workspaces/server/repository";
import type { WorkspaceKind } from "@/features/workspaces/types";
import {
  findChannelContainer,
  type ChannelContainer,
} from "./channel-container";

/**
 * Which channel is making this call, and may we bill its container for it — rule
 * B's first half (Samuel, 2026-09-13): charge the calling channel's container;
 * with no calling channel, charge the resource's container.
 *
 * Its own module because it asks a different question from `credits-service.ts`:
 * that file answers which WALLET a container's burn lands on, this one which
 * CONTAINER the burn belongs to — a question about the caller's session rather
 * than the addressed resource.
 *
 * The channel arrives on a forgeable header, so the fence is the point of this
 * file. The id comes from `X-Dopl-Session-Id`'s `<channelId>:<tail>` head, a
 * documented non-authorization signal any device-token holder can set
 * (`shared/auth/session-header.ts`, INVARIANTS §10), and under rule B it decides
 * whose wallet moves. So it is honoured only when the caller is an ACTIVE MEMBER
 * of the channel's container, and otherwise ignored (never refused — this path
 * fails open).
 *
 * Same direction-of-travel argument `knowledge/server/service-audience.ts
 * › narrowToSessionChannel` makes, applied to a bill instead of a read: the
 * header may only select a container the caller could already have addressed.
 * The worst a forged value achieves is charging a container the forger is a
 * member of. Without the fence, any account could drain a stranger's personal
 * wallet by naming their channel.
 */

/** The channel a call is attributed to, and the container its wallet belongs to. */
export type CallingChannel = ChannelContainer;

/**
 * The calling channel, or `null` for "no calling channel" — which is rule B's
 * own fallback (charge the resource's container), and what every channel-less
 * caller looks like: a Claude Desktop or Claude Code MCP connection, an app
 * click, an older desktop build.
 *
 * Round trips — this runs once per MCP tool call, so the split matters:
 *   * no `caller.channelId` → nothing is read at all.
 *   * the channel's container IS the addressed one (an agent in its own channel,
 *     the common case) → one read, the channel row. No membership read:
 *     `withWorkspaceAuth` already proved it and its kind is on the auth context.
 *   * the channel's container is ANOTHER one (a home-channel agent reading a
 *     workspace KB, the case rule B exists for) → two reads, the channel row and
 *     the membership row that fences it.
 *
 * A claim we drop is logged, never silent: both drops mean somebody's credits
 * went somewhere other than where the session said.
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
    // The auth context's kind wins over the embedded one: same row, and it is the
    // value every other decision on this request was made with. The embedded kind
    // is the fallback for the cross-container arm below.
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

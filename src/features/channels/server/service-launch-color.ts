import "server-only";
import {
  agentColorOrNull,
  firstFreeAgentColor,
  freeAgentColors,
} from "../lib/agent-colors";
import { AgentColorTakenError } from "./errors";
import {
  foreignLiveColorsByChannel,
  pendingDirectiveColors,
} from "./repository-session-colors";
import type { AgentColorKey } from "../types";
import type { ChannelContext } from "./service-shared";

/** Which colour the launch directive records. Runs below the idempotency probe (a stored row is this
 *  request's answer) and above presence (a collision needs nobody's machine).
 *  The taken set includes the caller's own live agents (`exceptUserId` null): this is a new agent.
 *  Refuses rather than substitutes, because the caller named the key and is waiting; the push lane
 *  substitutes instead (`session-colors.ts`). */
export async function resolveDirectiveColor(
  ctx: ChannelContext,
  channelId: string,
  wanted: AgentColorKey | undefined,
  /** Injectable so a test can state an age; the create passes nothing. */
  now: number = Date.now()
): Promise<AgentColorKey | null> {
  const [byChannel, directives] = await Promise.all([
    foreignLiveColorsByChannel(ctx.workspaceId, [channelId], null),
    pendingDirectiveColors(ctx.workspaceId, channelId),
  ]);
  // Live sessions ∪ unexpired pending directives. Expiry is lazy, so it is cut here; an unparseable
  // stamp counts as live (a 409 is cheaper than two agents sharing a colour).
  const taken = new Set<string>(byChannel.get(channelId) ?? []);
  for (const row of directives) {
    const at = Date.parse(row.expires_at);
    if (Number.isFinite(at) && at <= now) continue;
    const key = agentColorOrNull(row.color);
    if (key) taken.add(key);
  }
  if (!wanted) return firstFreeAgentColor(taken);
  if (taken.has(wanted)) {
    throw new AgentColorTakenError(wanted, freeAgentColors(taken));
  }
  return wanted;
}

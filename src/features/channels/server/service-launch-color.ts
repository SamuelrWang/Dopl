import "server-only";
import { agentColorOrNull } from "../lib/agent-colors";
import { pickAgentColor, rankFreeAgentColors } from "../lib/agent-color-pick";
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
  // Holders per key: live sessions + unexpired pending directives. Expiry is lazy, so it is cut
  // here; an unparseable stamp counts as live (better a spread than two agents on one free key).
  const taken = new Map<string, number>(byChannel.get(channelId)?.holders ?? []);
  for (const row of directives) {
    const at = Date.parse(row.expires_at);
    if (Number.isFinite(at) && at <= now) continue;
    const key = agentColorOrNull(row.color);
    if (key) taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  // Omitted: a free key, or with every key held the best one to share (`pickAgentColor`).
  if (!wanted) return pickAgentColor(taken);
  if (taken.has(wanted)) {
    // Best first, so the refusal's first suggestion is the key the server would itself pick.
    throw new AgentColorTakenError(wanted, rankFreeAgentColors(taken));
  }
  return wanted;
}

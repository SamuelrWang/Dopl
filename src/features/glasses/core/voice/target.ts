import type { ChannelLink, ChannelLinker } from "../devices/service";
import type { GlassesDevice } from "../devices/types";
import { isUuid } from "../validation";

/**
 * Where a device's voice / assistant utterance goes, in order:
 *   1. an EXPLICIT override on the request (the screen the wearer is on),
 *   2. the device's stored CURRENT TARGET (set by opening a chat/read view),
 *   3. FALLBACK: the owner's most recently active channel (member, live, not a DM).
 * Every candidate is re-validated (member of a live channel) before use: a
 * stale or foreign pick falls through to the next, never posts. None usable →
 * null (the caller answers "Open a channel on your glasses first").
 * There is no per-device linked channel.
 * An agent target means "@-address that agent"; a channel target is unaddressed.
 */

export const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

interface VoiceTarget {
  channel: ChannelLink;
  /** Agent id to @-address, or null for the channel's normal wake rules. */
  agentId: string | null;
  source: "override" | "current" | "recent";
}

interface TargetOverride {
  channelId?: string | null;
  agentId?: string | null;
}

/** `?channel_id=&agent=` (or `X-Glasses-Channel` / `X-Glasses-Agent`) off a request. */
export function targetOverrideFrom(request: Request): TargetOverride | null {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel_id") ?? request.headers.get("x-glasses-channel");
  const agentId = url.searchParams.get("agent") ?? request.headers.get("x-glasses-agent");
  return channelId ? { channelId, agentId: agentId || null } : null;
}

export async function resolveVoiceTarget(
  linker: ChannelLinker,
  device: Pick<GlassesDevice, "user_id" | "current_target_channel_id" | "current_target_agent">,
  override: TargetOverride | null,
): Promise<VoiceTarget | null> {
  const candidates: { channelId: string; agentId: string | null; source: VoiceTarget["source"] }[] = [];
  const push = (channelId: string | null | undefined, agentId: string | null | undefined, source: VoiceTarget["source"]) => {
    if (!channelId || !isUuid(channelId)) return;
    candidates.push({ channelId, agentId: agentId && AGENT_ID_RE.test(agentId) ? agentId : null, source });
  };
  push(override?.channelId, override?.agentId, "override");
  push(device.current_target_channel_id, device.current_target_agent, "current");
  if (candidates.length > 0) {
    // One membership read for every candidate, instead of one per fall-through.
    const links = await linker.linkable(device.user_id, [...new Set(candidates.map((c) => c.channelId))]);
    for (const { channelId, agentId, source } of candidates) {
      const channel = links.get(channelId);
      if (channel) return { channel, agentId, source };
    }
  }
  const recent = await linker.mostRecent(device.user_id);
  return recent ? { channel: recent, agentId: null, source: "recent" } : null;
}

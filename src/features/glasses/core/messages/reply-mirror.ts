import { glassesPlatform } from "../../platforms/registry";
import type { GlassesPlatform } from "../../platforms/types";
import { flattenChannelText } from "../channel-text";
import { iso, nowOf, type Clock } from "../clock";
import { linkOf, type ChannelLinker } from "../devices/service";
import type { DeviceStore, GlassesDevice } from "../devices/types";
import { GLASSES_LIMITS, clampBytes } from "../validation";
import type { ChannelGateway, ChannelReply } from "../voice/utterance";
import { RESERVED_CARD_PREFIX } from "./service";
import type { GlassesStore, ShowPayload } from "./types";

/**
 * Agent replies in a device's linked channel → glasses. Runs inside the device
 * inbox long-poll (no background worker): each pass reads agent `message` rows
 * past the device's `reply_cursor_seq` and queues one `show` card per row,
 * card_id `reply-<channel message id>`. A `show`, never a `notify`: a notify
 * auto-dismisses, and a reply must stay until the wearer taps it or it expires.
 * Idempotent twice over: the cursor only moves forward, and
 * `glasses_messages_reply_card_uidx` refuses a second row for the same reply.
 * A fresh cursor starts at the channel's head, never replaying history.
 */

const REPLY_TTL_SEC = 600;
const REPLIES_PER_PASS = 20;

export function replyToGlasses(
  platform: GlassesPlatform,
  reply: Pick<ChannelReply, "agentName" | "body">,
): { kind: "show"; payload: ShowPayload } | null {
  const title = clampBytes(platform.sanitizeText(reply.agentName) || "Agent", GLASSES_LIMITS.title);
  const body = flattenChannelText(reply.body, platform.sanitizeText).text;
  if (!body) return null;
  const lines = platform.wrapCardLines(body, { maxLines: GLASSES_LIMITS.lines.max, maxLineBytes: GLASSES_LIMITS.line });
  return { kind: "show", payload: { title, lines } };
}

export interface MirrorDeps extends Clock {
  store: GlassesStore;
  devices: DeviceStore;
  gateway: ChannelGateway;
  linker: ChannelLinker;
}

/**
 * Queue every new agent reply in `device`'s linked channel for its owner (all
 * of the owner's devices see it: the queue is per user). Returns how many were
 * queued and the stored cursor, which a caller polling in a loop feeds back in.
 *
 * 🔒 VISIBILITY IS RE-CHECKED EVERY PASS: replies are read with the service
 * role, so the pass first asks whether the owner may still see the channel.
 * If not, the device is UNLINKED and nothing is read (departure is removal).
 */
export async function mirrorReplies(
  deps: MirrorDeps,
  device: Pick<GlassesDevice, "id" | "user_id" | "platform" | "linked_channel_id" | "reply_cursor_seq">,
): Promise<{ queued: number; cursor: number | null; unlinked?: true }> {
  const channelId = device.linked_channel_id;
  if (!channelId) return { queued: 0, cursor: device.reply_cursor_seq };
  if (!(await linkOf(deps.linker, device.user_id, channelId))) {
    await deps.devices.updateDevice(device.user_id, device.id, { linkedChannelId: null });
    return { queued: 0, cursor: null, unlinked: true };
  }
  if (device.reply_cursor_seq === null) {
    const head = await deps.gateway.headSeq(channelId);
    await deps.devices.setReplyCursor(device.id, head);
    return { queued: 0, cursor: head };
  }
  const replies = await deps.gateway.agentMessagesAfter(channelId, device.reply_cursor_seq, REPLIES_PER_PASS);
  if (replies.length === 0) return { queued: 0, cursor: device.reply_cursor_seq };
  const platform = glassesPlatform(device.platform);
  const nowMs = nowOf(deps);
  let queued = 0;
  for (const reply of replies) {
    const msg = replyToGlasses(platform, reply);
    if (!msg) continue;
    const row = await deps.store.insertIfAbsent(device.user_id, {
      kind: msg.kind,
      card_id: `${RESERVED_CARD_PREFIX}${reply.id}`,
      payload: { ...msg.payload, channel_id: channelId, ...(reply.agentId ? { agent_session_id: reply.agentId } : {}) },
      expires_at: iso(nowMs + REPLY_TTL_SEC * 1000),
      now: iso(nowMs),
    });
    if (row) queued += 1;
  }
  const cursor = replies[replies.length - 1].seq;
  await deps.devices.setReplyCursor(device.id, cursor);
  return { queued, cursor };
}

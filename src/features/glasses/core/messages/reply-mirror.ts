import { glassesPlatform } from "../../platforms/registry";
import type { GlassesPlatform } from "../../platforms/types";
import { flattenChannelText } from "../channel-text";
import { iso, nowOf, type Clock } from "../clock";
import type { ChannelLinker } from "../devices/service";
import type { DeviceStore, GlassesDevice } from "../devices/types";
import { GLASSES_LIMITS, clampBytes, isUuid } from "../validation";
import type { ChannelGateway, ChannelReply } from "../voice/utterance";
import { RESERVED_CARD_PREFIX } from "./service";
import type { GlassesStore, ShowPayload } from "./types";

/**
 * Agent replies → glasses, run inside the inbox long-poll (≤ one pass per device per 5s).
 * SCOPE: the device's current-target channel + every channel it posted to (voice / Hey Even)
 * in 24h. One query per pass; one `show` card per reply (`reply-<message id>`) — a `show`, never
 * a `notify`, which would auto-dismiss. Idempotent: cursors only move forward and
 * `glasses_messages_reply_card_uidx` refuses a duplicate.
 * NO HISTORY REPLAY: a channel entering scope (no row, or cursor older than
 * {@link CURSOR_STALE_MS}) starts at its head; a post starts it at the post's seq.
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

/** A posted-to channel stays in scope this long after the device's last post there. */
export const POST_SCOPE_MS = 24 * 60 * 60 * 1000;
/** A cursor not confirmed for this long restarts at the head (= the reply card TTL). */
export const CURSOR_STALE_MS = REPLY_TTL_SEC * 1000;
/** An unchanged cursor is re-confirmed (written) at most this often. */
const CURSOR_REFRESH_MS = CURSOR_STALE_MS / 2;

const age = (nowMs: number, at: string | null) => (at ? nowMs - Date.parse(at) : Infinity);

/**
 * Put `channelId` in the device's mirror scope for {@link POST_SCOPE_MS}. A fresh cursor is
 * kept (pending replies still mirror); else it starts AT the post, so nothing older mirrors.
 */
export async function recordDevicePost(
  deps: Pick<MirrorDeps, "devices"> & Clock,
  deviceId: string,
  channelId: string,
  seq: number,
): Promise<void> {
  const nowMs = nowOf(deps);
  const row = (await deps.devices.listChannelActivity(deviceId)).find((r) => r.channel_id === channelId);
  const fresh = row && age(nowMs, row.cursor_at) < CURSOR_STALE_MS;
  await deps.devices.recordChannelPost(deviceId, channelId, iso(nowMs), fresh ? null : { seq, at: iso(nowMs) });
}

/**
 * Queue every new agent reply in `device`'s scope for its owner (the queue is per user).
 * 🔒 VISIBILITY RE-CHECKED EVERY PASS: replies are read with the service role, so channels the
 * owner may no longer see are skipped unread (departure is removal).
 */
export async function mirrorReplies(
  deps: MirrorDeps,
  device: Pick<GlassesDevice, "id" | "user_id" | "platform" | "current_target_channel_id">,
): Promise<{ queued: number; channels: string[] }> {
  const nowMs = nowOf(deps);
  const rows = await deps.devices.listChannelActivity(device.id);
  const scope = new Set(rows.filter((r) => age(nowMs, r.last_posted_at) < POST_SCOPE_MS).map((r) => r.channel_id));
  if (device.current_target_channel_id && isUuid(device.current_target_channel_id)) scope.add(device.current_target_channel_id);
  if (scope.size === 0) return { queued: 0, channels: [] };
  const visible = await deps.linker.linkable(device.user_id, [...scope]);
  const channels = [...scope].filter((id) => visible.has(id));
  if (channels.length === 0) return { queued: 0, channels: [] };

  const byChannel = new Map(rows.map((r) => [r.channel_id, r]));
  const live = new Map<string, number>();
  const entering: string[] = [];
  for (const id of channels) {
    const row = byChannel.get(id);
    if (row && age(nowMs, row.cursor_at) < CURSOR_STALE_MS) live.set(id, row.reply_cursor_seq);
    else entering.push(id);
  }
  const writes: { channelId: string; seq: number; at: string }[] = [];
  // Entering channels start at their head: nothing older is ever replayed.
  const heads = await Promise.all(entering.map((id) => deps.gateway.headSeq(id)));
  entering.forEach((id, i) => writes.push({ channelId: id, seq: heads[i], at: iso(nowMs) }));

  let queued = 0;
  if (live.size > 0) {
    const replies = await deps.gateway.agentMessagesAfterMany(live, REPLIES_PER_PASS);
    const platform = glassesPlatform(device.platform);
    for (const [channelId, cursor] of live) {
      const list = replies.get(channelId) ?? [];
      for (const reply of list) {
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
      const next = list.length ? list[list.length - 1].seq : cursor;
      // Write a moved cursor, or re-confirm an idle one before it goes stale.
      if (next !== cursor || age(nowMs, byChannel.get(channelId)!.cursor_at) >= CURSOR_REFRESH_MS) {
        writes.push({ channelId, seq: next, at: iso(nowMs) });
      }
    }
  }
  await deps.devices.setChannelCursors(device.id, writes);
  return { queued, channels };
}

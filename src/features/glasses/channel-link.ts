import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { ChannelLinker } from "./devices-service";
import { isUuid } from "./text";

/**
 * The real {@link ChannelLinker}. A channel is LINKABLE — and so visible to the
 * device model at all — only while it is live (not deleted, not archived) and
 * the user is a member of it. The same rule answers the claim/PATCH check, the
 * device list's channel names, and the reply mirror's per-pass re-check, so a
 * member who leaves (departure = removal) stops receiving that room's replies
 * and stops seeing its name. Posting re-checks membership through the channels
 * service itself (`voice-channel.ts`).
 */

interface ChannelRow {
  id: string;
  name: string;
  workspace_id: string;
  archived_at: string | null;
  deleted_at: string | null;
}

/** The subset of `ids` that `userId` may link, with names and containers. */
async function linkable(userId: string, ids: string[]): Promise<Map<string, ChannelRow>> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return new Map();
  const db = supabaseAdmin();
  const [channels, members] = await Promise.all([
    db.from("channels").select("id, name, workspace_id, archived_at, deleted_at").in("id", valid),
    db.from("channel_members").select("channel_id").eq("user_id", userId).in("channel_id", valid),
  ]);
  const err = channels.error ?? members.error;
  if (err) throw new Error(`glasses channel read failed: ${err.message}`);
  const memberOf = new Set(((members.data ?? []) as { channel_id: string }[]).map((m) => m.channel_id));
  const out = new Map<string, ChannelRow>();
  for (const c of (channels.data ?? []) as ChannelRow[]) {
    if (!c.deleted_at && !c.archived_at && memberOf.has(c.id)) out.set(c.id, c);
  }
  return out;
}

export const channelLinker: ChannelLinker = {
  async resolveLink(userId, channelId) {
    const row = (await linkable(userId, [channelId])).get(channelId);
    if (!row) {
      throw new HttpError(404, "CHANNEL_NOT_FOUND", "No such channel, or you cannot link it (not a member, archived or deleted).");
    }
    return { channelId: row.id, containerId: row.workspace_id, name: row.name };
  },

  async visibleChannelNames(userId, ids) {
    const rows = await linkable(userId, ids);
    return new Map([...rows].map(([id, r]) => [id, r.name]));
  },

  async isLinkable(userId, channelId) {
    return (await linkable(userId, [channelId])).has(channelId);
  },
};

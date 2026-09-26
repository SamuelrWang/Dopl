import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { ChannelLinker } from "./devices-service";
import { isUuid } from "./text";

/**
 * The real {@link ChannelLinker}: a device may be linked only to a live
 * (not deleted, not archived) channel its owner is a MEMBER of, because voice
 * posts there as that owner. Posting re-checks membership through the channels
 * service (`voice-channel.ts`), so a later departure fails closed there too.
 */
export const channelLinker: ChannelLinker = {
  async resolveLink(userId, channelId) {
    const notFound = new HttpError(404, "CHANNEL_NOT_FOUND", "No such channel, or you are not a member of it.");
    if (!isUuid(channelId)) throw notFound;
    const db = supabaseAdmin();
    const [{ data: channel, error: chErr }, { data: member, error: mErr }] = await Promise.all([
      db
        .from("channels")
        .select("id, name, workspace_id, archived_at, deleted_at")
        .eq("id", channelId)
        .maybeSingle(),
      db
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channelId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (chErr || mErr) throw new Error(`glasses channel link read failed: ${(chErr ?? mErr)!.message}`);
    const row = channel as { id: string; name: string; workspace_id: string; archived_at: string | null; deleted_at: string | null } | null;
    if (!row || row.deleted_at || !member) throw notFound;
    if (row.archived_at) throw new HttpError(400, "CHANNEL_ARCHIVED", "That channel is archived.");
    return { channelId: row.id, containerId: row.workspace_id, name: row.name };
  },

  async channelNames(ids) {
    const { data, error } = await supabaseAdmin().from("channels").select("id, name").in("id", ids);
    if (error) throw new Error(`glasses channel names read failed: ${error.message}`);
    return new Map(((data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  },
};

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "../validation";
import type { ChannelLink, ChannelLinker } from "./service";

/**
 * The real {@link ChannelLinker}. A channel is LINKABLE, and so visible to the
 * device model at all, only while it is live (not deleted, not archived) and
 * the user is a member of it. The same rule answers claim/PATCH, the device
 * list's channel names, voice targets, the menu and the reply mirror's per-pass
 * re-check, so a member who leaves (departure = removal) stops receiving that
 * room's replies and stops seeing its name.
 */

interface ChannelRow {
  id: string;
  name: string;
  workspace_id: string;
  archived_at: string | null;
  deleted_at: string | null;
}

async function linkable(userId: string, ids: string[]): Promise<Map<string, ChannelLink>> {
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
  const out = new Map<string, ChannelLink>();
  for (const c of (channels.data ?? []) as ChannelRow[]) {
    if (!c.deleted_at && !c.archived_at && memberOf.has(c.id)) {
      out.set(c.id, { channelId: c.id, containerId: c.workspace_id, name: c.name });
    }
  }
  return out;
}

export const channelLinker: ChannelLinker = { linkable };

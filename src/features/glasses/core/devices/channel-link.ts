import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { ACCOUNT_CHANNEL_LIMIT } from "@/features/channels/server/repository-account";
import { listAccountChannelRows } from "@/features/channels/server/repository-list-extras";
import { lastMessages } from "@/features/channels/server/repository-messages";
import { isUuid } from "../validation";
import type { ChannelLink, ChannelLinker } from "./service";

/**
 * The real {@link ChannelLinker}. A channel is LINKABLE, and so visible to the
 * device model at all, only while it is live (not deleted, not archived) and
 * the user is a member of it. The same rule answers voice targets (and their
 * most-recent fallback), the menu and the reply mirror's per-pass re-check, so
 * a member who leaves (departure = removal) stops receiving that room's replies
 * and stops seeing its name.
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

/** How many top candidates the fallback re-confirms through {@link linkable}. */
const RECENT_CONFIRM = 5;

/**
 * The user's most recently active channel (last message, else creation), for
 * voice with no target. Direct messages are excluded: an untargeted utterance
 * must never land in a one-to-one conversation with another person. The top
 * candidates are re-confirmed through {@link linkable}, the one membership rule.
 */
async function mostRecent(userId: string): Promise<ChannelLink | null> {
  const { rows } = await listAccountChannelRows(userId, null, ACCOUNT_CHANNEL_LIMIT);
  const live = rows.filter((r) => !r.archived_at && !r.deleted_at && !r.is_direct);
  if (live.length === 0) return null;
  const lasts = await lastMessages(live.map((r) => r.id));
  const ranked = live
    .map((r) => ({ id: r.id, at: Date.parse(lasts.get(r.id) ?? r.created_at) || 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_CONFIRM)
    .map((r) => r.id);
  const links = await linkable(userId, ranked);
  for (const id of ranked) {
    const link = links.get(id);
    if (link) return link;
  }
  return null;
}

export const channelLinker: ChannelLinker = { linkable, mostRecent };

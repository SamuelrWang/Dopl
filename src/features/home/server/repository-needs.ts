import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { ESCALATION_METADATA_KEY } from "@/features/channels/escalation";
import { mentionContainmentFilter } from "@/features/channels/server/repository-mentions";
import { TASK_READ_COLS, type ChannelTaskReadRow } from "@/features/channels/server/dto-tasks";

/**
 * The Needs you reads. Admin client; every channel id comes from the service's fence
 * (`service-needs.ts › visibleHomeChannels`), never from the request.
 */

const DECISION_COLS =
  "id,seq,channel_id,author_user_id,author_kind,client_msg_id,metadata,created_at";

export type DecisionCandidateRow = {
  id: string;
  seq: number | string;
  channel_id: string;
  author_user_id: string | null;
  author_kind: string;
  client_msg_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Decision cards that may be the reader's: those tagging them, and those they authored (an
 * untagged card is its author's). `answerersOf` decides which really are, so a card that tagged
 * somebody else is dropped there, not here.
 */
export async function listDecisionCandidates(
  channelIds: readonly string[],
  userId: string,
  limit: number
): Promise<{ tagged: DecisionCandidateRow[]; authored: DecisionCandidateRow[] }> {
  if (channelIds.length === 0) return { tagged: [], authored: [] };
  const base = () =>
    supabaseAdmin()
      .from("channel_messages")
      .select(DECISION_COLS)
      .in("channel_id", channelIds)
      .not(`metadata->${ESCALATION_METADATA_KEY}`, "is", null);
  const [column, value] = mentionContainmentFilter(userId);
  const [tagged, authored] = await Promise.all([
    base().contains(column, value).order("seq", { ascending: false }).limit(limit),
    base().eq("author_user_id", userId).order("seq", { ascending: false }).limit(limit),
  ]);
  if (tagged.error) throw tagged.error;
  if (authored.error) throw authored.error;
  return {
    tagged: (tagged.data ?? []) as DecisionCandidateRow[],
    authored: (authored.data ?? []) as DecisionCandidateRow[],
  };
}

/**
 * Unresolved tasks the reader holds as a person. The `mine` embed is the inner-joined filter; the
 * full `channel_task_assignees` embed in {@link TASK_READ_COLS} is untouched by it.
 */
export async function listAssignedOpenTasks(
  channelIds: readonly string[],
  userId: string,
  limit: number
): Promise<ChannelTaskReadRow[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await supabaseAdmin()
    .from("channel_tasks")
    .select(`${TASK_READ_COLS}, mine:channel_task_assignees!inner(user_id, agent_id)`)
    .in("channel_id", channelIds)
    .in("status", ["open", "in_progress"])
    .eq("mine.user_id", userId)
    .is("mine.agent_id", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ChannelTaskReadRow[];
}

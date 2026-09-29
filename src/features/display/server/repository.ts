import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "@/features/channels/server/dto";
import { DISPLAY_METADATA_KEY, type DisplayAnswerStamp, type DisplayEnvelopeV2 } from "../core/types";

/**
 * The display statements (migration `unified_display`): replace-in-place and the answer stamp are
 * ONE statement each (RPCs, service_role only); the two reads are narrow selects.
 */

const db = () => supabaseAdmin();

/** Replace an UNANSWERED display in place, fenced to its author. False = answered / not theirs. */
export async function replaceDisplay(
  messageId: string,
  authorUserId: string,
  body: string,
  display: DisplayEnvelopeV2,
  escalation: unknown | null
): Promise<boolean> {
  const { data, error } = await db().rpc("replace_channel_message_display", {
    p_message_id: messageId,
    p_author_user_id: authorUserId,
    p_body: body,
    p_display: display,
    p_escalation: escalation,
  });
  if (error) throw new Error(`display replace failed: ${error.message}`);
  return data === true;
}

/** Stamp `metadata.display.answer` once (CAS). False = already stamped, or no display. */
export async function stampAnswer(messageId: string, answer: DisplayAnswerStamp): Promise<boolean> {
  const { data, error } = await db().rpc("stamp_channel_message_display_answer", { p_message_id: messageId, p_answer: answer });
  if (error) throw new Error(`display answer stamp failed: ${error.message}`);
  return data === true;
}

/** The newest message in `channelId` carrying `displayId`, authored by `authorUserId`. */
export async function findByDisplayId(channelId: string, displayId: string, authorUserId: string): Promise<ChannelMessageRow | null> {
  const { data, error } = await db()
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("author_user_id", authorUserId)
    .eq(`metadata->${DISPLAY_METADATA_KEY}->>display_id`, displayId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`display lookup failed: ${error.message}`);
  return (data as ChannelMessageRow | null) ?? null;
}

/** A message by id alone, for the lens tap (the lens row knows the message, not its channel). */
export async function findMessageRow(id: string): Promise<ChannelMessageRow | null> {
  const { data, error } = await db().from("channel_messages").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`display message read failed: ${error.message}`);
  return (data as ChannelMessageRow | null) ?? null;
}

/** Whether an answer message references this decision (the stamp may lag the answer). */
export async function hasAnswerMessage(channelId: string, messageId: string): Promise<boolean> {
  const { count, error } = await db()
    .from("channel_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .eq("metadata->escalationAnswer->>escalationMessageId", messageId);
  if (error) throw new Error(`display answer lookup failed: ${error.message}`);
  return (count ?? 0) > 0;
}

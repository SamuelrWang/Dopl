import "server-only";
import type { DoplClient } from "@dopl/client";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelDisplays } from "./channel-mirror";
import type { MessageDisplayStamp } from "./display";

/**
 * The real {@link ChannelDisplays}. `patch` is ONE statement
 * (`merge_channel_message_display`, migration `device_aware_messages`), fenced to the message's
 * author account. `post` goes through the caller's own loopback client, so the display message is
 * written exactly like the agent's `dopl_send_message` (agent author, session stamp); it wakes
 * nobody (`intent: "chat"`).
 */

export async function patchChannelDisplay(
  userId: string,
  messageId: string,
  patch: Partial<MessageDisplayStamp>
): Promise<void> {
  const { error } = await supabaseAdmin().rpc("merge_channel_message_display", {
    p_message_id: messageId,
    p_author_user_id: userId,
    p_patch: patch,
  });
  if (error) throw new Error(`display patch failed: ${error.message}`);
}

/** `post` only when the MCP call came from a Dopl channel session (`channelId`). */
export function channelDisplays(client: DoplClient | null, channelId: string | null): ChannelDisplays {
  if (!client || !channelId) return { patch: patchChannelDisplay };
  return {
    patch: patchChannelDisplay,
    async post(display, body) {
      const posted = await client.postChannelMessage(channelId, {
        body,
        intent: "chat",
        display: {
          blocks: display.blocks as unknown as Record<string, unknown>[],
          ...(display.layout ? { layout: display.layout } : {}),
          ...(display.wait_for_input ? { wait_for_input: true } : {}),
        },
      });
      return posted.id;
    },
  };
}

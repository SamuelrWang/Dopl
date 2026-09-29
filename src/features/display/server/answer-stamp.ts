import "server-only";
import { ESCALATION_ANSWER_METADATA_KEY, parseEscalationAnswer } from "@/features/channels/escalation";
import type { ChannelMessageRow } from "@/features/channels/server/dto";
import { findMessageById } from "@/features/channels/server/repository-messages";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import { answerAsk } from "@/features/glasses/core/messages/inbox";
import { glassesRepository } from "@/features/glasses/core/messages/repository";
import { displayOf } from "../core/adapt";
import { choiceOf, DISPLAY_METADATA_KEY } from "../core/types";
import { stampAnswer } from "./repository";

/**
 * **THE POST-INSERT HOOK** (spec §5.3 step 3): after ANY insert carrying `escalationAnswer` — the
 * press, the typed door, an old desktop's POST — the answered display is stamped
 * (`display.answer`, CAS) and a linked lens row is released (so a lens hold returns and the lens
 * updates). BEST EFFORT, LOGGED: the answer message is the fact of record, and every reader's
 * pre-pass still shows it.
 */
export async function onAnswerInserted(ctx: ChannelContext, channelId: string, row: ChannelMessageRow): Promise<void> {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const answer = parseEscalationAnswer(metadata[ESCALATION_ANSWER_METADATA_KEY]);
  if (!answer) return;
  try {
    const target = await findMessageById(channelId, answer.escalationMessageId);
    const targetMeta = (target?.metadata ?? {}) as Record<string, unknown>;
    if (!target || typeof targetMeta[DISPLAY_METADATA_KEY] !== "object") return;
    const display = displayOf(targetMeta);
    const choice = display && choiceOf(display.blocks);
    const option = choice?.options[answer.optionIndex];
    if (!display || !choice || !option) return;
    await stampAnswer(target.id, {
      block_id: choice.id,
      index: answer.optionIndex,
      choice: option.label,
      at: row.created_at,
      via: ctx.messageSource?.kind ?? "web",
      by: ctx.userId,
      message_id: row.id,
    });
    if (display.glasses_message_id && target.author_user_id) {
      // "Already answered" (a lens tap that came first) is the ordinary case, not a failure.
      await answerAsk({ store: glassesRepository }, target.author_user_id, {
        id: display.glasses_message_id,
        index: answer.optionIndex,
        choice: option.label,
        block_id: choice.id,
      });
    }
  } catch (err) {
    console.error("[display] answer stamp failed", err);
  }
}

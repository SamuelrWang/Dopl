import "server-only";
import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel, type ChannelContext } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import { EscalationAlreadyAnsweredError } from "@/features/channels/server/errors";
import { ChannelRecipientUnresolvedError } from "@/features/channels/server/errors-recipient";
import { isHeld } from "@/features/channels/server/service-writes-metadata-escalation";
import type { ChannelMessageRow } from "@/features/channels/server/dto";
import type { MessageSourceStamp } from "@/features/channels/server/message-source-stamp";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import { agentIdHandle } from "@/features/channels/lib/agent-mentions";
import { iso } from "@/features/glasses/core/clock";
import { answerAsk } from "@/features/glasses/core/messages/inbox";
import { glassesRepository } from "@/features/glasses/core/messages/repository";
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import { operatorChannelContext } from "@/features/glasses/core/channel-context";
import { displayOf } from "../core/adapt";
import { answerersOf } from "../core/answerers";
import { firstTextLine } from "../core/fallback";
import { checkTemplateSpec, templateNameFrom, templateVariables } from "../core/template";
import { choiceOf, DISPLAY_METADATA_KEY, type Display, type DisplayAnswerStamp } from "../core/types";
import { findMessageRow, stampAnswer } from "./repository";

/**
 * **ONE ANSWER ROUTE FOR EVERY DISPLAY** (spec §3.3, contract C2) and the Save button.
 *   - Decision lane (`metadata.escalation`: every new choice display and every legacy decision):
 *     today's escalation answer — a member message carrying `escalationAnswer`, so fold 11's
 *     404/403 order, the derived wake and the one-answer index (409) all apply unchanged. The
 *     post-insert hook (`answer-stamp.ts`) stamps the display and releases a linked lens row.
 *   - Legacy lane (v1 dev rows: a selectable list, no escalation): the pre-unification path,
 *     moved verbatim. ⚠ Remove after 1.38 ships.
 */

export const DisplayAnswerSchema = z.object({
  index: z.number().int().min(0),
  block_id: z.string().max(32).nullable().optional(),
  // Accepted for older clients and ignored: the index decides.
  choice: z.string().max(200).optional(),
});
export const DisplaySaveSchema = z.object({ name: z.string().max(200).optional() });

const notFound = () => new HttpError(404, "DISPLAY_NOT_FOUND", "No display on that message.");
const answered = () => new HttpError(409, "DISPLAY_ANSWERED", "Already answered.");

async function loadDisplay(ctx: ChannelContext, channelRef: string, messageId: string, action: string) {
  const { channel } = await requireMemberChannel(ctx, channelRef, action);
  const row = isUuid(messageId) ? await findMessageById(channel.id, messageId) : null;
  const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
  const display = row ? displayOf(metadata) : null;
  if (!row || !display) throw notFound();
  return { channelId: channel.id, row, metadata, display };
}

export async function answerDisplay(
  ctx: ChannelContext,
  channelRef: string,
  messageId: string,
  input: z.infer<typeof DisplayAnswerSchema>
): Promise<{ ok: true; answer: DisplayAnswerStamp }> {
  const { channelId, row, metadata, display } = await loadDisplay(ctx, channelRef, messageId, "answer this display");
  const choice = choiceOf(display.blocks);
  const option = choice?.options[input.index];
  if (!choice || !option || (input.block_id && input.block_id !== choice.id)) {
    throw new HttpError(400, "DISPLAY_BAD_CHOICE", "No such choice on this display.");
  }
  if (display.superseded_by) {
    throw new HttpError(409, "DISPLAY_SUPERSEDED", "This decision was withdrawn: the agent replaced it.");
  }
  if (!answerersOf(metadata, row.author_user_id).includes(ctx.userId)) {
    throw new HttpError(403, "DISPLAY_NOT_YOURS", "Only the person this was shown to can answer it.");
  }
  const via = ctx.messageSource?.kind ?? "web";
  if (!display.decision) return legacyLane(ctx, channelId, row, metadata, display, choice.id, input.index, option.label, via);

  const held = isHeld(metadata);
  let posted;
  try {
    posted = await postMessage(ctx, channelId, {
      body: option.label,
      clientMsgId: `display-answer-${row.id}`,
      escalationAnswer: { escalationMessageId: row.id, optionIndex: input.index },
      // ⚠ HELD (§3.4): the asking agent's hold returns this answer, so the message wakes and
      // feeds nobody — `agentId` is already null (fold 11), and `autoAddress:false` stops RR3
      // re-aiming a person's unaddressed post at the room's most recent agent.
      ...(held && { intent: "chat" as const, autoAddress: false }),
    });
  } catch (err) {
    if (err instanceof EscalationAlreadyAnsweredError) throw answered();
    throw err;
  }
  // The idempotency key is per message: a replay is this member pressing twice.
  if (posted.replayed) throw answered();
  return {
    ok: true,
    answer: { block_id: choice.id, index: input.index, choice: option.label, at: posted.createdAt, via, by: ctx.userId, message_id: posted.id },
  };
}

/** v1 dev rows (no decision index). Glasses-linked → the lens tap's path; else stamp + a reply. */
async function legacyLane(
  ctx: ChannelContext,
  channelId: string,
  row: ChannelMessageRow,
  metadata: Record<string, unknown>,
  display: Display,
  blockId: string,
  index: number,
  label: string,
  via: string
): Promise<{ ok: true; answer: DisplayAnswerStamp }> {
  if (display.glasses_message_id) {
    const outcome = await answerAsk({ store: glassesRepository }, ctx.userId, { id: display.glasses_message_id, index, choice: label, block_id: blockId });
    if (!outcome.ok) throw new HttpError(outcome.status, "DISPLAY_ANSWER_REFUSED", outcome.error);
  } else if (display.answer) {
    throw answered();
  }
  const answer: DisplayAnswerStamp = { block_id: blockId, index, choice: label, at: iso(Date.now()), via, by: ctx.userId };
  if (!(await stampAnswer(row.id, answer)) && !display.glasses_message_id) throw answered();
  if (display.glasses_message_id) return { ok: true, answer };
  const agentId = authorAgentIdOf({ clientMsgId: row.client_msg_id, metadata });
  const reply = { body: label, clientMsgId: `display-answer-${row.id}` };
  try {
    await postMessage(ctx, channelId, agentId ? { ...reply, to: `@${agentIdHandle(agentId)}` } : reply);
  } catch (err) {
    // The agent that asked has ended: the answer still lands, for the room's normal rule to route.
    if (!(err instanceof ChannelRecipientUnresolvedError)) throw err;
    await postMessage(ctx, channelId, reply);
  }
  return { ok: true, answer };
}

/**
 * A LENS TAP on a row linked to a decision (spec §5.3): after `answerAsk` settled the lens row,
 * the same answer is posted through the decision lane as the device owner, from glasses. When the
 * decision was already answered (in the app, in the gap), the lens row is re-synced to THAT answer
 * so the lens, `glasses_get_answer` and the stamp agree, and the tap reports the conflict.
 */
export async function answerFromLens(userId: string, row: GlassesMessage, source: MessageSourceStamp): Promise<"ok" | "conflict"> {
  if (!row.channel_message_id || !row.answer) return "ok";
  try {
    const message = await findMessageRow(row.channel_message_id);
    const meta = (message?.metadata ?? {}) as Record<string, unknown>;
    if (!message || !displayOf(meta)?.decision) return "ok";
    const ctx = { ...(await operatorChannelContext(userId, message.workspace_id)), messageSource: source };
    try {
      await answerDisplay(ctx, message.channel_id, message.id, { index: row.answer.index });
      return "ok";
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 409)) throw err;
      await syncLensToStamp(userId, row, message.channel_id, message.id);
      return "conflict";
    }
  } catch (err) {
    console.error("[display] lens answer post failed", err);
    return "ok";
  }
}

/** The decision's stamp (or its answer message's index) onto the linked lens row. */
async function syncLensToStamp(userId: string, row: GlassesMessage, channelId: string, messageId: string) {
  const fresh = await findMessageById(channelId, messageId);
  const stamp = displayOf((fresh?.metadata ?? {}) as Record<string, unknown>)?.answer;
  if (!stamp || stamp.index === row.answer?.index) return;
  await glassesRepository.transition(userId, row.id, ["answered"], "answered", iso(Date.now()), {
    choice: stamp.choice,
    index: stamp.index,
    at: stamp.at,
    block_id: stamp.block_id,
  });
}

export async function saveDisplayTemplate(
  ctx: ChannelContext,
  channelRef: string,
  messageId: string,
  input: z.infer<typeof DisplaySaveSchema>
) {
  const { metadata, display } = await loadDisplay(ctx, channelRef, messageId, "save this display");
  if (typeof metadata[DISPLAY_METADATA_KEY] !== "object") throw notFound();
  const name = templateNameFrom(input.name, firstTextLine(display.blocks) || "display");
  const spec = checkTemplateSpec({ blocks: display.blocks, layout: display.layout === "absolute" ? "absolute" : undefined });
  const t = await glassesRepository.saveTemplate(ctx.userId, name, spec, iso(Date.now()));
  return { name: t.name, variables: templateVariables(spec), updated_at: t.updated_at };
}

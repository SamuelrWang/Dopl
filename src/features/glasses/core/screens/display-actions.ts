import "server-only";
import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel, type ChannelContext } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import { ChannelRecipientUnresolvedError } from "@/features/channels/server/errors-recipient";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";
import { agentIdHandle } from "@/features/channels/lib/agent-mentions";
import { answerAsk } from "../messages/inbox";
import { glassesRepository } from "../messages/repository";
import { deviceRepository } from "../devices/repository";
import type { GlassesDeps } from "../messages/service";
import { GlassesValidationError } from "../validation";
import { answerMirror } from "./channel-mirror";
import { patchChannelDisplay } from "./channel-displays";
import { DISPLAY_METADATA_KEY, type DisplayBlock, type MessageDisplayStamp } from "./display";
import { saveTemplate } from "./service";

/**
 * **THE DISPLAY CARD'S TWO WRITES FROM THE APP** (docs/specs/device-aware-messages.md):
 * answer a selectable list, and save a display as a template.
 *
 * ⚠ ANSWER PARITY: a display linked to a glasses row is answered through the SAME path a tap on
 * the lens takes (`inbox.ts › answerAsk`), so a waiting `glasses_ask` / `wait_for_input` returns
 * `answered` either way, and the card is stamped by the same `answerMirror`. A channel-only display
 * has no hold to release, so its answer is ALSO posted as the member's message to the agent that
 * showed it — the wake an agent can act on.
 */

export const DisplayAnswerSchema = z.object({
  index: z.number().int().min(0),
  block_id: z.string().max(32).nullable().optional(),
  choice: z.string().max(200).optional(),
});
export const DisplaySaveSchema = z.object({ name: z.string().max(200).optional() });

const deps: GlassesDeps = { store: glassesRepository, devices: deviceRepository, displays: { patch: patchChannelDisplay } };
const notFound = () => new HttpError(404, "DISPLAY_NOT_FOUND", "No display on that message.");

async function loadDisplay(ctx: ChannelContext, channelRef: string, messageId: string, action: string) {
  const { channel } = await requireMemberChannel(ctx, channelRef, action);
  const row = isUuid(messageId) ? await findMessageById(channel.id, messageId) : null;
  const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
  const display = metadata[DISPLAY_METADATA_KEY] as MessageDisplayStamp | undefined;
  if (!row || !display || !Array.isArray(display.blocks)) throw notFound();
  return { channel, row, metadata, display };
}

export async function answerDisplay(
  ctx: ChannelContext,
  channelRef: string,
  messageId: string,
  input: z.infer<typeof DisplayAnswerSchema>
) {
  const { channel, row, metadata, display } = await loadDisplay(ctx, channelRef, messageId, "answer this display");
  // The choices belong to the account whose agent showed them (its glasses row is theirs too).
  if (row.author_user_id !== ctx.userId) {
    throw new HttpError(403, "DISPLAY_NOT_YOURS", "Only the person this was shown to can answer it.");
  }
  const list = display.blocks.find(
    (b: DisplayBlock) => b.type === "list" && b.selectable && (input.block_id ? b.id === input.block_id : true)
  );
  const items = list?.items ?? [];
  if (!list || input.index >= items.length) throw new HttpError(400, "DISPLAY_BAD_CHOICE", "No such choice on this display.");
  const via = ctx.messageSource?.kind ?? "web";

  if (display.glasses_message_id) {
    const outcome = await answerAsk(deps, ctx.userId, {
      id: display.glasses_message_id,
      index: input.index,
      choice: items[input.index],
      block_id: list.id,
    });
    if (!outcome.ok) throw new HttpError(outcome.status, "DISPLAY_ANSWER_REFUSED", outcome.error);
    if (outcome.message) await answerMirror(deps, ctx.userId, outcome.message, via);
    return { ok: true as const, answer: outcome.message?.answer ?? null };
  }

  if (display.answer) throw new HttpError(409, "DISPLAY_ANSWERED", "Already answered.");
  const answer = { block_id: list.id, choice: items[input.index], index: input.index, at: new Date().toISOString(), via };
  await patchChannelDisplay(ctx.userId, row.id, { answer });
  const agentId = authorAgentIdOf({ clientMsgId: row.client_msg_id, metadata });
  const reply = { body: answer.choice, clientMsgId: `display-answer-${row.id}` };
  try {
    await postMessage(ctx, channel.id, agentId ? { ...reply, to: `@${agentIdHandle(agentId)}` } : reply);
  } catch (err) {
    // The agent that asked has ended: the answer still lands, for the room's normal rule to route.
    if (!(err instanceof ChannelRecipientUnresolvedError)) throw err;
    await postMessage(ctx, channel.id, reply);
  }
  return { ok: true as const, answer };
}

/** `a-z 0-9 _ -`, ≤64 — the template name rule (`template.ts › cleanTemplateName`). */
function templateNameFrom(raw: string | undefined, blocks: DisplayBlock[]): string {
  const source = raw?.trim() || blocks.find((b) => b.type === "text" && b.content)?.content?.split("\n")[0] || "display";
  const slug = source.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || "display";
}

export async function saveDisplayTemplate(
  ctx: ChannelContext,
  channelRef: string,
  messageId: string,
  input: z.infer<typeof DisplaySaveSchema>
) {
  const { display } = await loadDisplay(ctx, channelRef, messageId, "save this display");
  try {
    return await saveTemplate(deps, ctx.userId, {
      name: templateNameFrom(input.name, display.blocks),
      blocks: display.blocks,
      layout: display.layout,
    });
  } catch (err) {
    // A display bigger than the glasses can hold is not a template (templates render on glasses).
    if (err instanceof GlassesValidationError) throw new HttpError(400, "DISPLAY_NOT_A_TEMPLATE", err.message);
    throw err;
  }
}

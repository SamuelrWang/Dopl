import { g2Measurer, type TextMeasurer } from "./measure";
import { sanitizeGlassesText, utf8Bytes } from "./text";
import type { GlassesStore, NotifyPayload, ShowPayload } from "./types";
import type { ChannelGateway, ChannelReply } from "./voice-utterance";

/**
 * Agent replies in the linked channel → glasses. Runs inside the device inbox
 * long-poll (no background worker): each tick reads agent `message` rows past
 * the device's cursor and queues one glasses message per row, card_id
 * `reply-<channel message id>`. Idempotent twice over: the cursor only moves
 * forward, and `glasses_messages_reply_card_uidx` refuses a second row for the
 * same reply. A fresh cursor starts at the channel's head, never replaying history.
 */

export const REPLY_NOTIFY_MAX_BYTES = 180;
export const REPLY_TTL_SEC = 600;
const TITLE_MAX_BYTES = 64;
const LINE_MAX_BYTES = 100;
const MAX_LINES = 4;
/** Text width inside a full-width show card (576 - 2*8 margin - 2*4 padding - slack). */
const LINE_WIDTH_PX = 536;
const ELLIPSIS = "…";

/** Markdown an agent writes, flattened for a monochrome text display. */
export function plainReply(body: string): string {
  return sanitizeGlassesText(
    body
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "- ")
      .replace(/\s*\n\s*/g, " "),
  );
}

function clampBytes(s: string, max: number): string {
  let out = s;
  while (utf8Bytes(out) > max) out = out.slice(0, -1);
  return out;
}

/** Word-wrap to G2 pixel width and a byte cap; the last kept line ends in … when cut. */
export function wrapLines(text: string, m: TextMeasurer = g2Measurer): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (m.width(next) <= LINE_WIDTH_PX && utf8Bytes(next) <= LINE_MAX_BYTES) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = word;
    while (m.width(cur) > LINE_WIDTH_PX || utf8Bytes(cur) > LINE_MAX_BYTES) {
      let cut = cur.length - 1;
      while (cut > 1 && (m.width(cur.slice(0, cut)) > LINE_WIDTH_PX || utf8Bytes(cur.slice(0, cut)) > LINE_MAX_BYTES)) cut--;
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  let last = kept[MAX_LINES - 1];
  while (last && (m.width(last + ELLIPSIS) > LINE_WIDTH_PX || utf8Bytes(last + ELLIPSIS) > LINE_MAX_BYTES)) {
    last = last.slice(0, -1);
  }
  kept[MAX_LINES - 1] = last.trimEnd() + ELLIPSIS;
  return kept;
}

export function replyToGlasses(
  reply: Pick<ChannelReply, "agentName" | "body">,
  m: TextMeasurer = g2Measurer,
): { kind: "notify"; payload: NotifyPayload } | { kind: "show"; payload: ShowPayload } | null {
  const title = clampBytes(sanitizeGlassesText(reply.agentName) || "Agent", TITLE_MAX_BYTES);
  const body = plainReply(reply.body);
  if (!body) return null;
  if (utf8Bytes(body) <= REPLY_NOTIFY_MAX_BYTES) return { kind: "notify", payload: { title, body } };
  return { kind: "show", payload: { title, lines: wrapLines(body, m) } };
}

export interface MirrorDeps {
  store: GlassesStore;
  gateway: ChannelGateway;
  now?: () => number;
  measurer?: TextMeasurer;
}

/** Queue every new agent reply in `channelId` for `userId`'s glasses. Returns how many were queued. */
export async function mirrorReplies(deps: MirrorDeps, userId: string, channelId: string): Promise<number> {
  const nowMs = (deps.now ?? Date.now)();
  const now = new Date(nowMs).toISOString();
  const cursor = await deps.store.getReplyCursor(userId);
  if (cursor.channelId !== channelId || cursor.seq === null) {
    await deps.store.setReplyCursor(userId, channelId, await deps.gateway.headSeq(channelId), now);
    return 0;
  }
  const replies = await deps.gateway.agentMessagesAfter(channelId, cursor.seq, 20);
  if (replies.length === 0) return 0;
  let queued = 0;
  for (const reply of replies) {
    const msg = replyToGlasses(reply, deps.measurer);
    if (!msg) continue;
    const row = await deps.store.insertIfAbsent(userId, {
      kind: msg.kind,
      card_id: `reply-${reply.id}`,
      payload: msg.payload,
      expires_at: new Date(nowMs + REPLY_TTL_SEC * 1000).toISOString(),
      now,
    });
    if (row) queued += 1;
  }
  await deps.store.setReplyCursor(userId, channelId, replies[replies.length - 1].seq, now);
  return queued;
}

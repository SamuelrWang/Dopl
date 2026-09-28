import type { GlassesMessage, GlassesStore } from "../messages/types";
import {
  displayFallback,
  displayStamp,
  normalizeDisplay,
  type MessageDisplayStamp,
} from "./display";

/**
 * **A GLASSES SCREEN, MIRRORED INTO THE CHANNEL IT CAME FROM** — `metadata.display` on an agent
 * message (docs/specs/device-aware-messages.md). Pure over two ports:
 *   - `post` exists only when the MCP call came from a Dopl channel session (`exposure.ts`);
 *     an external client posts nothing.
 *   - `patch` merges into a display message the user's account authored, whatever the caller —
 *     a re-render, `glasses_update` and an answer all land on the SAME message.
 * ⚠ BEST EFFORT, ALWAYS: a mirror that fails never fails the glasses call (it only logs).
 */

export interface ChannelDisplays {
  post?: (display: MessageDisplayStamp, body: string) => Promise<string>;
  patch: (userId: string, messageId: string, patch: Partial<MessageDisplayStamp>) => Promise<void>;
}

export interface MirrorDeps {
  store: GlassesStore;
  displays?: ChannelDisplays;
}

type Spec = { blocks?: unknown; layout?: unknown };

async function quietly<T>(label: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (err) {
    console.error(`[glasses] channel mirror ${label} failed`, err);
    return null;
  }
}

function toDisplay(spec: Spec) {
  const result = normalizeDisplay(spec);
  return result.ok ? result : null;
}

/** BEFORE a new glasses row: post its display in the calling channel. The message id, or null. */
export async function postMirror(
  deps: MirrorDeps,
  spec: Spec,
  screenId: string,
  waitForInput: boolean
): Promise<string | null> {
  const post = deps.displays?.post;
  const display = post ? toDisplay(spec) : null;
  if (!post || !display) return null;
  return quietly("post", () =>
    post(displayStamp(screenId, { ...display, wait_for_input: waitForInput }), displayFallback(display.blocks))
  );
}

/** AFTER the row exists: the channel message learns which glasses row it mirrors. */
export async function linkMirror(deps: MirrorDeps, userId: string, messageId: string | null, row: GlassesMessage) {
  if (!messageId || !deps.displays) return;
  const { patch } = deps.displays;
  // The glasses screen id replaces the one the post route minted, so the card names the screen.
  const screen = row.card_id ? { screen_id: row.card_id } : {};
  await quietly("link", () => patch(userId, messageId, { glasses_message_id: row.id, ...screen }));
}

/**
 * An EXISTING row changed (a re-render of the same screen_id, `glasses_update`): patch its channel
 * message in place and clear any answer (the screen is live again); a row never mirrored gets one
 * now when this call has a channel. `waitForInput` undefined leaves the stored flag alone.
 */
export async function refreshMirror(
  deps: MirrorDeps,
  userId: string,
  row: GlassesMessage,
  spec: Spec,
  waitForInput?: boolean
): Promise<void> {
  if (!deps.displays) return;
  if (!row.channel_message_id) {
    const id = await postMirror(deps, spec, row.card_id ?? row.id, waitForInput === true);
    if (!id) return;
    await quietly("link", () => deps.store.linkChannelMessage(userId, row.id, id));
    await linkMirror(deps, userId, id, row);
    return;
  }
  const display = toDisplay(spec);
  if (!display) return;
  const { patch } = deps.displays;
  const messageId = row.channel_message_id;
  await quietly("patch", () =>
    patch(userId, messageId, {
      blocks: display.blocks,
      layout: display.layout,
      answer: null,
      ...(waitForInput === undefined ? {} : { wait_for_input: waitForInput }),
    })
  );
}

/** A row was answered (on the lens or in the app): the channel card shows it. */
export async function answerMirror(deps: MirrorDeps, userId: string, row: GlassesMessage, via: string) {
  if (!deps.displays || !row.channel_message_id || !row.answer) return;
  const { patch } = deps.displays;
  const messageId = row.channel_message_id;
  const { choice, index, at, block_id } = row.answer;
  await quietly("answer", () => patch(userId, messageId, { answer: { block_id: block_id ?? null, choice, index, at, via } }));
}

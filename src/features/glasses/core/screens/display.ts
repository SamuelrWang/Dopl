import { z } from "zod";
import { normalizeSpec, type NormBlock } from "./normalize";
import type { ScreenError, ScreenLayout, ScreenLimits } from "./spec";

/**
 * **AN AGENT-BUILT DISPLAY IN CHAT** — reserved `channel_messages.metadata.display`
 * (docs/specs/device-aware-messages.md). The SAME block vocabulary as `glasses_render`
 * (`spec.ts`), validated platform-neutrally by `normalize.ts` under chat-sized limits: the G2
 * compiler only runs for glasses. Client-safe (no server imports): the UI reads these types.
 */

export const DISPLAY_METADATA_KEY = "display";
export const DISPLAY_SPEC_VERSION = 1;

export type DisplayBlock = NormBlock;

export interface DisplayAnswerStamp {
  block_id: string | null;
  choice: string;
  index: number;
  at: string;
  /** The surface that answered (`metadata.source.kind` vocabulary). */
  via: string;
}

export interface MessageDisplayStamp {
  spec_version: typeof DISPLAY_SPEC_VERSION;
  screen_id: string;
  blocks: DisplayBlock[];
  layout?: ScreenLayout;
  wait_for_input?: boolean;
  glasses_message_id?: string;
  answer?: DisplayAnswerStamp | null;
}

/** Chat has room the lens does not; the SHAPE rules (one selectable list, ids, types) are shared. */
const CHAT_LIMITS: ScreenLimits = {
  max_blocks: 24,
  max_text_blocks: 24,
  text_bytes: 2000,
  list_items: 50,
  selectable_list_items: 50,
  list_item_bytes: 200,
  one_selectable_per_screen: true,
  max_lines_per_text: 40,
  label_bytes: 120,
};

// C0 controls (newline and tab kept) and DEL: nothing a chat renderer should draw.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const chatSanitize = (s: string) => s.replace(CONTROL, "").trim();

export type DisplayResult =
  | { ok: true; blocks: DisplayBlock[]; layout: ScreenLayout }
  | { ok: false; errors: ScreenError[] };

export function normalizeDisplay(spec: { blocks?: unknown; layout?: unknown }): DisplayResult {
  const { blocks, layout, errors } = normalizeSpec(spec, { limits: CHAT_LIMITS, sanitize: chatSanitize });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, blocks, layout };
}

/** A screen id for a display posted without glasses. */
export const newDisplayId = () => `d-${globalThis.crypto.randomUUID().slice(0, 8)}`;

/** The stored stamp; `layout` omitted when it is the default stack. */
export function displayStamp(
  screenId: string,
  display: { blocks: DisplayBlock[]; layout: ScreenLayout; wait_for_input?: boolean },
  glassesMessageId?: string
): MessageDisplayStamp {
  return {
    spec_version: DISPLAY_SPEC_VERSION,
    screen_id: screenId,
    blocks: display.blocks,
    ...(display.layout === "absolute" ? { layout: display.layout } : {}),
    ...(display.wait_for_input ? { wait_for_input: true } : {}),
    ...(glassesMessageId ? { glasses_message_id: glassesMessageId } : {}),
  };
}

/** `glasses_ask` as a display: the question, then its options as the one selectable list. */
export function askDisplaySpec(question: string, options: string[]) {
  return {
    blocks: [
      { id: "question", type: "text", content: question },
      { id: "options", type: "list", items: options, selectable: true },
    ],
  };
}

const BODY_MAX = 4000;

/**
 * The plain-text body a display message carries — what every surface that does not draw
 * displays shows (an MCP read, the glasses inbox, an older app).
 */
export function displayFallback(blocks: DisplayBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.content) lines.push(b.content);
    else if (b.type === "list") lines.push(...(b.items ?? []).map((item, i) => (b.selectable ? `${i + 1}. ${item}` : `- ${item}`)));
    else if (b.type === "progress" && b.value !== undefined) {
      lines.push(`${b.label ? `${b.label} ` : ""}${Math.round(b.value * 100)}%`);
    } else if (b.type === "divider") lines.push("---");
  }
  const text = lines.join("\n").trim() || "Display";
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text;
}

/**
 * `display` on `POST /api/channels/:id/messages` (and `dopl_send_message`): blocks + layout +
 * wait flag only — the screen id, glasses link and answer are server-owned.
 */
export const DisplayInputSchema = z
  .object({
    blocks: z.array(z.unknown()).min(1),
    layout: z.enum(["stack", "absolute"]).optional(),
    wait_for_input: z.boolean().optional(),
  })
  .transform((input, ctx) => {
    const result = normalizeDisplay(input);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.errors.map((e) => (e.block ? `${e.block}: ${e.message}` : e.message)).join("; ") });
      return z.NEVER;
    }
    return { blocks: result.blocks, layout: result.layout, wait_for_input: input.wait_for_input === true };
  });

export type DisplayInput = z.output<typeof DisplayInputSchema>;

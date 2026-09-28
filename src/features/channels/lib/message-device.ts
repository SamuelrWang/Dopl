/**
 * **WHERE A MESSAGE CAME FROM, AND WHAT AN AGENT SHOWED WITH IT** — the two reserved,
 * server-written metadata keys the transcript reads (docs/specs/device-aware-messages.md).
 *
 * - `metadata.source` — the device a MEMBER posted from (`glasses` / `computer` / `web` / `phone`).
 * - `metadata.display` — an agent-built display in the glasses block vocabulary
 *   (`glasses/core/screens/spec.ts`), rendered platform-neutrally by `display-card.tsx`.
 *
 * ⚠ **TOLERANT READERS, NEVER VALIDATORS.** The server validated both at write time; a row this
 * build cannot read (an older server, a future field shape) returns `null` and the transcript
 * renders the plain body, which is why every display message carries a text fallback. Server-side
 * validation is `glasses/core/screens/display.ts › normalizeDisplay`; stamping is
 * `channels/server/message-source.ts`.
 */

import {
  BLOCK_TYPES,
  type BlockType,
  type ScreenLayout,
  type ScreenSpec,
} from "@/features/glasses/core/screens/spec";

/** Open on purpose, like `devices/types.ts › DeviceKind`: a new kind renders generically. */
export type MessageSourceKind = "glasses" | "computer" | "web" | "phone" | (string & {});

export interface MessageSource {
  kind: MessageSourceKind;
  /** The registered device, when there is one — the UI prefers its LIVE name (a rename). */
  deviceId: string | null;
  /** The name at write time — the fallback when the device is gone or not the viewer's. */
  label: string;
}

export type DisplayBlock = ScreenSpec["blocks"][number];

/** A selectable list's answer, from whichever surface answered it (glasses, desktop, web). */
export interface DisplayAnswer {
  blockId: string | null;
  choice: string;
  index: number;
}

export interface MessageDisplay {
  screenId: string;
  blocks: DisplayBlock[];
  layout: ScreenLayout;
  answer: DisplayAnswer | null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export function messageSourceOf(metadata: Json | null | undefined): MessageSource | null {
  const source = metadata?.source;
  if (!isObject(source)) return null;
  const kind = str(source.kind);
  const label = str(source.label);
  if (!kind || !label) return null;
  return { kind, deviceId: str(source.device_id), label };
}

function answerOf(display: Json): DisplayAnswer | null {
  const raw = display.answer;
  if (!isObject(raw)) return null;
  const choice = str(raw.choice);
  if (choice === null || typeof raw.index !== "number") return null;
  return { blockId: str(raw.block_id), choice, index: raw.index };
}

export function messageDisplayOf(metadata: Json | null | undefined): MessageDisplay | null {
  const display = metadata?.display;
  if (!isObject(display) || !Array.isArray(display.blocks)) return null;
  const blocks = display.blocks.filter(
    (block): block is DisplayBlock =>
      isObject(block) && BLOCK_TYPES.includes(block.type as BlockType)
  );
  if (blocks.length === 0) return null;
  return {
    screenId: str(display.screen_id) ?? "",
    blocks,
    layout: display.layout === "absolute" ? "absolute" : "stack",
    answer: answerOf(display),
  };
}

/**
 * **THE ONE DISPLAY VOCABULARY** (docs/specs/unified-display.md §2). An agent composes a display
 * from these blocks once; every surface draws the SAME spec its own way (the desktop/web card, the
 * G2 lens via `degrade.ts`, text-only readers via `fallback.ts`). Client-safe: no server imports
 * (the desktop renderer's ESLint fence).
 */

export const DISPLAY_SPEC_VERSION = 2;
/** The reserved `channel_messages.metadata` key a display is stored under (server-written). */
export const DISPLAY_METADATA_KEY = "display";

export const BLOCK_TYPES = ["heading", "text", "fields", "list", "choice", "progress", "table", "divider", "spacer"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

interface BlockBase {
  id: string;
}

export interface HeadingBlock extends BlockBase {
  type: "heading";
  text: string;
}
export interface TextBlock extends BlockBase {
  type: "text";
  /** Newlines allowed. */
  content: string;
  /** Omitted = default ink. */
  tone?: "muted" | "strong";
  // Glasses hints (v1); chat renderers ignore all but `border`.
  lines?: number;
  brightness?: 0 | 1 | 2 | 3 | 4;
  border?: boolean;
}
export interface FieldsBlock extends BlockBase {
  type: "fields";
  rows: { label: string; value: string }[];
}
/** Information only (a choice is `choice`); omitted style = bullets. */
export interface ListBlock extends BlockBase {
  type: "list";
  items: string[];
  style?: "number";
}
export interface ChoiceOption {
  label: string;
  description?: string;
  recommended?: true;
  why?: string;
}
export interface ChoiceBlock extends BlockBase {
  type: "choice";
  options: ChoiceOption[];
}
export interface ProgressBlock extends BlockBase {
  type: "progress";
  value: number;
  label?: string;
}
export interface TableBlock extends BlockBase {
  type: "table";
  columns: string[];
  rows: string[][];
}
export interface DividerBlock extends BlockBase {
  type: "divider";
}
export interface SpacerBlock extends BlockBase {
  type: "spacer";
  lines?: number;
}

export type DisplayBlock =
  | HeadingBlock
  | TextBlock
  | FieldsBlock
  | ListBlock
  | ChoiceBlock
  | ProgressBlock
  | TableBlock
  | DividerBlock
  | SpacerBlock;

/** x/y/w/h survive only on layout "absolute" (glasses_render); chat renderers only ORDER by them. */
export type Positioned<B> = B & { x?: number; y?: number; w?: number; h?: number };

export type DisplayLayout = "stack" | "absolute";

export interface DisplayAnswerStamp {
  /** The choice block's id. */
  block_id: string;
  /** 0-based option index — THE answer. */
  index: number;
  /** The option label at answer time. */
  choice: string;
  /** ISO. */
  at: string;
  /** `metadata.source.kind` vocabulary. */
  via: "glasses" | "computer" | "web" | "phone" | (string & {});
  /** The answering member's user id (absent on v1/lens-only answers). */
  by?: string;
  /** The answer message (decision lane). */
  message_id?: string;
}

export type DisplayOrigin =
  | "dopl_show"
  | "dopl_request_decision"
  | "glasses_render"
  | "glasses_ask"
  | "glasses_use_template"
  | "glasses_update";

/** Stored at `channel_messages.metadata.display` (reserved, server-written). */
export interface DisplayEnvelopeV2 {
  spec_version: 2;
  /** `[A-Za-z0-9_-]{1,64}`; server `d-xxxxxxxx` unless the caller named one. */
  display_id: string;
  blocks: Positioned<DisplayBlock>[];
  /** Omitted = stack. */
  layout?: "absolute";
  /** ISO; set while an agent hold may still consume the answer (spec §3.4). */
  wait_until?: string;
  /** The linked lens row. */
  glasses_message_id?: string;
  answer?: DisplayAnswerStamp | null;
  origin?: DisplayOrigin;
  /** Set when a replace by `display_id` dropped this decision's choice: the message that replaced it.
   *  A superseded display is closed — no answer, no decision index. */
  superseded_by?: string;
}

/** What every reader gets from `adapt.ts › displayOf`. */
export interface Display {
  from: "v2" | "v1" | "escalation";
  display_id: string;
  blocks: Positioned<DisplayBlock>[];
  layout: DisplayLayout;
  answer: DisplayAnswerStamp | null;
  wait_until: string | null;
  glasses_message_id: string | null;
  /** `metadata.escalation` is present: answers go through the decision lane (spec §5). */
  decision: boolean;
  /** The message that superseded this display (closed: render read-only, no answer). */
  superseded_by?: string | null;
}

export type DisplayErrorCode =
  | "bad_value"
  | "unknown_key"
  | "too_many_blocks"
  | "text_too_long"
  | "list_too_long"
  | "multiple_choice"
  | "bad_recommendation"
  | "table_shape"
  | "duplicate_id";

export interface DisplayError {
  block?: string;
  code: DisplayErrorCode;
  message: string;
}

/** The neutral limits (spec §2.2): what a display may carry anywhere; the lens degrades at render. */
export const DISPLAY_LIMITS = {
  blocks: 24,
  heading: 120,
  text: 2000,
  textLines: 40,
  fieldsRows: 12,
  fieldLabel: 40,
  fieldValue: 200,
  listItems: 20,
  listItem: 200,
  options: { min: 2, max: 12 },
  /** A v1 selectable list read as a choice keeps v1's bounds (glasses_render; stored v1 rows). */
  v1Options: { min: 1, max: 19 },
  optionLabel: 80,
  optionDescription: 200,
  optionWhy: 200,
  progressLabel: 120,
  tableColumns: { min: 2, max: 4 },
  tableColumn: 40,
  tableRows: 10,
  tableCell: 60,
  spacerLines: 4,
  fallback: 4000,
} as const;

export const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const DISPLAY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A display id the server mints when the caller named none. */
export const newDisplayId = () => `d-${globalThis.crypto.randomUUID().slice(0, 8)}`;

/** The one answerable block (at most one per display), or null. */
export function choiceOf(blocks: readonly DisplayBlock[]): ChoiceBlock | null {
  return (blocks.find((b) => b.type === "choice") as ChoiceBlock | undefined) ?? null;
}

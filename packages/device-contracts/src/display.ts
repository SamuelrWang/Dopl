/**
 * C6 — the cross-device display language (spec v1 › C6).
 *
 * ⚠ **A MIRROR, NOT A RE-EXPORT.** Block vocabulary v2 is defined by the Dopl app (`DisplayBlock`,
 * `DISPLAY_LIMITS`). This package is standalone and imports nothing outside itself, so the nine v2
 * blocks are restated here as zod and HELD EQUAL by a parity test on the Dopl side (type-level
 * mutual assignability + the limits deep-equal). Change one, change both, together.
 *
 * The SDK adds one block the app does not have yet: `image` (C6 "Additions").
 */
import { z } from "zod";

/** Mirror of the Dopl app's `DISPLAY_LIMITS` (parity-tested). */
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

/** SDK-only limits for the `image` block. */
export const IMAGE_LIMITS = { url: 2048, alt: 200 } as const;

/** Mirror of `› BLOCK_TYPES`, plus `image`. */
export const V2_BLOCK_TYPES = ["heading", "text", "fields", "list", "choice", "progress", "table", "divider", "spacer"] as const;
export const SDK_BLOCK_TYPES = [...V2_BLOCK_TYPES, "image"] as const;
export type SdkBlockType = (typeof SDK_BLOCK_TYPES)[number];

const L = DISPLAY_LIMITS;
const BlockId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const HeadingBlockSchema = z.object({ id: BlockId, type: z.literal("heading"), text: z.string().max(L.heading) });
export const TextBlockSchema = z.object({
  id: BlockId,
  type: z.literal("text"),
  content: z.string().max(L.text),
  tone: z.enum(["muted", "strong"]).optional(),
  lines: z.number().int().min(1).max(L.textLines).optional(),
  brightness: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  border: z.boolean().optional(),
});
export const FieldsBlockSchema = z.object({
  id: BlockId,
  type: z.literal("fields"),
  rows: z
    .array(z.object({ label: z.string().max(L.fieldLabel), value: z.string().max(L.fieldValue) }))
    .max(L.fieldsRows),
});
export const ListBlockSchema = z.object({
  id: BlockId,
  type: z.literal("list"),
  items: z.array(z.string().max(L.listItem)).max(L.listItems),
  style: z.literal("number").optional(),
});
export const ChoiceOptionSchema = z.object({
  label: z.string().max(L.optionLabel),
  description: z.string().max(L.optionDescription).optional(),
  recommended: z.literal(true).optional(),
  why: z.string().max(L.optionWhy).optional(),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;
export const ChoiceBlockSchema = z.object({
  id: BlockId,
  type: z.literal("choice"),
  options: z.array(ChoiceOptionSchema).min(L.options.min).max(L.options.max),
});
export const ProgressBlockSchema = z.object({
  id: BlockId,
  type: z.literal("progress"),
  value: z.number().min(0).max(1),
  label: z.string().max(L.progressLabel).optional(),
});
export const TableBlockSchema = z.object({
  id: BlockId,
  type: z.literal("table"),
  columns: z.array(z.string().max(L.tableColumn)).min(L.tableColumns.min).max(L.tableColumns.max),
  rows: z.array(z.array(z.string().max(L.tableCell))).min(1).max(L.tableRows),
});
export const DividerBlockSchema = z.object({ id: BlockId, type: z.literal("divider") });
export const SpacerBlockSchema = z.object({
  id: BlockId,
  type: z.literal("spacer"),
  lines: z.number().int().min(1).max(L.spacerLines).optional(),
});
/** SDK addition: an https image; devices without a raster screen degrade it to `alt`. */
export const ImageBlockSchema = z.object({
  id: BlockId,
  type: z.literal("image"),
  url: z.url({ protocol: /^https$/ }).max(IMAGE_LIMITS.url),
  alt: z.string().min(1).max(IMAGE_LIMITS.alt),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

/** The nine app blocks — the parity target. */
export const V2DisplayBlockSchema = z.discriminatedUnion("type", [
  HeadingBlockSchema,
  TextBlockSchema,
  FieldsBlockSchema,
  ListBlockSchema,
  ChoiceBlockSchema,
  ProgressBlockSchema,
  TableBlockSchema,
  DividerBlockSchema,
  SpacerBlockSchema,
]);
export type V2DisplayBlock = z.infer<typeof V2DisplayBlockSchema>;

/** Every block the SDK accepts: v2 + `image`. */
export const DisplayBlockSchema = z.discriminatedUnion("type", [...V2DisplayBlockSchema.options, ImageBlockSchema]);
export type DisplayBlock = z.infer<typeof DisplayBlockSchema>;

/** A block list as `deliver` / `present.display` carry it: at most one `choice`, unique ids. */
export const DisplayBlocksSchema = z
  .array(DisplayBlockSchema)
  .min(1)
  .max(L.blocks)
  .refine((bs) => bs.filter((b) => b.type === "choice").length <= 1, { message: "at most one choice block" })
  .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, { message: "block ids must be unique" });

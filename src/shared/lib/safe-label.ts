import { z } from "zod";

/**
 * THE SHORT-LABEL CHARACTER RULE — ⚠ ONE definition for every name/title a user
 * types and an agent later reads. Two copies of a neutralizer drift, and the
 * copy that drifts is the one that stops neutralizing.
 *
 * Input side of prompt-injection defence: a tool result is a message a model
 * reads, and server-written parts read as the SERVER speaking, so a newline plus
 * `##` forges a heading in that voice. `packages/mcp-server`'s
 * `neutralizeInline` stays the primary defence at render; a field that can never
 * hold a newline cannot forge a line in surfaces that forget to neutralize.
 *
 * Rejects, and nothing more: control chars (C0/DEL); zero-width + bidi overrides
 * (U+200B–U+200F, U+2060–U+206F, U+FEFF); line/paragraph separators U+2028–
 * U+202F, which several renderers still treat as newlines.
 *
 * ⚠ Deliberately ALLOWS everything else — accents, emoji, CJK, Arabic, Cyrillic.
 * A rule about STRUCTURE-FORGING characters, not about scripts.
 *
 * ⚠ NOT FOR BODIES. Knowledge entry bodies, SKILL.md, transcripts, a skill's
 * `description`/`whenToUse` are legitimately multi-line markdown. The line is
 * VALUE (spliced into a line we wrote) vs BODY (rendered as itself).
 */
export const SAFE_LABEL_RE =
  /^[^\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/u;

/** User-facing copy built from the field's own name. ⚠ One sentence shared by
 *  every field, so the product says the same thing about the same rule. */
export function safeLabelMessage(subject: string): string {
  return `${subject} cannot contain control, zero-width, or line-separator characters`;
}

/**
 * PROSE, not a label. Same class as {@link SAFE_LABEL_RE} except NEWLINE and TAB
 * are allowed.
 *
 * ⚠ The distinction is not "short vs long" but WHO GUARANTEES the rendering. A
 * label is spliced into a line we wrote; prose is rendered as itself, and where
 * a prose field is flattened onto one line for a listing,
 * `tools/narration.ts` neutralizes it at render.
 */
export const SAFE_PROSE_RE =
  /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/u;

/** Prose twin of {@link safeLabelMessage}. */
export function safeProseMessage(subject: string): string {
  return `${subject} cannot contain control, zero-width, or line-separator characters`;
}

/** Optional prose: trimmed, ≤`max` chars, newlines allowed. Empty string is
 *  preserved, not rejected. */
export function safeOptionalProse(subject: string, max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === "" || SAFE_PROSE_RE.test(v), {
      message: safeProseMessage(subject),
    });
}

/**
 * Required short label: trimmed, 1..`max` chars, charset-bounded.
 *
 * ⚠ `.trim()` MUST run first — the matching database CHECK requires
 * `col = btrim(col)`, so without it a padded value passes validation and then
 * fails the constraint as an opaque 500.
 */
export function safeLabel(subject: string, max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(SAFE_LABEL_RE, safeLabelMessage(subject));
}

/**
 * Same rule where EMPTY is legitimate. `SAFE_LABEL_RE` requires ≥1 char, hence
 * the explicit empty-string branch rather than a looser pattern.
 *
 * Callers add `.nullable()` / `.optional()` — which "absent" spelling a column
 * accepts is per-field.
 */
export function safeOptionalLabel(subject: string, max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === "" || SAFE_LABEL_RE.test(v), {
      message: safeLabelMessage(subject),
    });
}

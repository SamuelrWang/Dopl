import { z } from "zod";

/**
 * THE SHORT-LABEL CHARACTER RULE — one definition, for every name and title a
 * user types and an agent later reads.
 *
 * WHY THIS EXISTS. A tool result is not a document; it is a message a model
 * reads, and the parts the server writes are read as the SERVER speaking. A
 * newline plus `##` forges a heading in that voice. `packages/mcp-server`'s
 * `neutralizeInline` is the guarantee and stays the primary defence — it holds
 * whatever the database contains. This module is the INPUT side of the same
 * rule: a field that can never hold a newline cannot forge a line ANYWHERE,
 * including in surfaces written later that forget to neutralize (the web UI,
 * the desktop listener's prompt assembly, an export, a future renderer).
 *
 * THE ONE DEFINITION. Two copies of a neutralizer drift, and the copy that
 * drifts is the one that stops neutralizing — the same argument
 * `tools/narration.ts` makes for its own single home. This regex was first
 * written as `DISPLAY_NAME_RE` in `src/app/api/user/profile/route.ts` and
 * mirrored as `CHANNEL_TEXT_RE` in `src/features/channels/schema.ts`; both now
 * import it from here, character for character unchanged, and so does every
 * short label bounded since.
 *
 * WHAT IT REJECTS, and nothing more:
 *   - control characters — the newline that forges a line, and every other
 *     C0 / DEL byte;
 *   - zero-width and bidi-override characters (U+200B–U+200F, U+2060–U+206F,
 *     U+FEFF) — invisible payload, and the reordering trick that makes a label
 *     read as something other than what it stores;
 *   - the line and paragraph separators U+2028 / U+2029 and their neighbours
 *     through U+202F, which several renderers still treat as newlines.
 *
 * WHAT IT DELIBERATELY ALLOWS: everything else. Accents, apostrophes, em
 * dashes, emoji, CJK, Arabic, Cyrillic — "Müller's Team", "研究ノート",
 * "Café — Zürich" are all ordinary names and a rule that rejected them would
 * be worse than no rule at all. This is a rule about STRUCTURE-FORGING
 * characters, not about scripts.
 *
 * NOT FOR BODIES. A knowledge entry's body, a SKILL.md, a chat transcript, a
 * skill's `description` / `whenToUse` — those are the payload the product
 * exists to hand an agent, they are legitimately multi-line markdown, and
 * stripping that would break the feature. The line drawn here is the same one
 * `tools/narration.ts` draws: between a VALUE (a name, a title, a label,
 * spliced into a line we wrote) and a BODY (content rendered as itself, under
 * framing that says what it is).
 */
export const SAFE_LABEL_RE =
  /^[^\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/u;

/**
 * The user-facing copy, built from the field's own name so the person renaming
 * a workspace reads "Workspace name cannot contain..." and not a regex. Kept
 * as one sentence shared by every field: the wording is identical to the copy
 * `display_name` and the channel header already shipped with, so the product
 * says the same thing about the same rule wherever it is hit.
 */
export function safeLabelMessage(subject: string): string {
  return `${subject} cannot contain control, zero-width, or line-separator characters`;
}

/**
 * PROSE, not a label. Same class as {@link SAFE_LABEL_RE} except that NEWLINE
 * and TAB are allowed, because a multi-line body is what the field is for.
 *
 * The distinction that matters is not "short vs long" but WHO GUARANTEES the
 * rendering. A label is spliced into a line we wrote, so a newline inside it
 * forges structure. Prose is rendered as itself — and where a prose field is
 * flattened onto one line for a listing (a workspace description trails its
 * name in the MCP directory table), `tools/narration.ts` neutralizes it at the
 * render, which is the guarantee that lets the input stay honest.
 *
 * Bounding a textarea against Enter would have been a validation error in a
 * control that invites the key — the affordance is not the bug, forging a line
 * in someone else's tool output is, and that is closed at the renderer.
 */
export const SAFE_PROSE_RE =
  /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/u;

/** The prose twin of {@link safeLabelMessage}: names the classes still refused. */
export function safeProseMessage(subject: string): string {
  return `${subject} cannot contain control, zero-width, or line-separator characters`;
}

/**
 * An optional prose field: trimmed, up to `max` characters, newlines allowed.
 * Empty string is preserved as empty rather than rejected, matching how the
 * optional-label helper treats a cleared field.
 */
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
 * A required short label: trimmed, 1..`max` characters, charset-bounded.
 *
 * `.trim()` runs first, so a padded label is stored tidy and a whitespace-only
 * one is rejected rather than silently becoming "". That trim is load-bearing
 * rather than cosmetic — the matching database CHECK requires
 * `col = btrim(col)`, and without it a padded value would pass validation and
 * then fail the constraint as an opaque 500.
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
 * The same rule where EMPTY is a legitimate value — a cleared description, an
 * unfiled folder, an untitled step. `SAFE_LABEL_RE` requires at least one
 * character, hence the explicit empty-string branch rather than a looser
 * pattern: "" carries nothing to forge with.
 *
 * Callers add `.nullable()` / `.optional()` themselves, since which of the
 * three "absent" spellings a column accepts is per-field.
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

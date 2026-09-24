/**
 * `dopl_kb` WRITE-VALIDATION MAPPERS — **a 400 from a knowledge route turned
 * into a refusal that names the FIELD, its RULE and the RECOVERY.**
 *
 * ⚠ **ITS OWN MODULE SINCE 2026-09-18 (S52), BECAUSE `knowledge-shared.ts` HIT
 * THE §1 500-LINE CAP.** The seam is a real one: that file RESOLVES refs and
 * maps the two 403s every base write can raise; this one owns the `zod` →
 * sentence translation, which grows a branch every time a field gains a rule.
 *
 * 🔒 **THE RULE THE WHOLE MODULE EXISTS FOR: A BRANCH NAMES ITS OWN FIELD'S
 * RULE AND NO OTHER FIELD'S.** Until this wave a 301-character `excerpt` fell
 * through to the generic arm, which printed *"Titles can't contain '/'"* — so
 * the refusal named `excerpt` and then taught the TITLE rule, and an agent that
 * fixed its title got the same answer again. Every new field gets its own arm,
 * or it does not get a number.
 */

import { callRef } from "../call-ref.js";
import { err, type ToolResponse } from "./respond";
import { fieldTooLong, KB_INVALID_FIELD, refusal } from "./tool-errors";

/**
 * The two caps the mappers below QUOTE BY NUMBER, restated here because this
 * package cannot import `src/config`.
 *
 * ⚠ **HAND-MIRRORED, AND EACH HAS TWO SOURCES ON THE OTHER SIDE**:
 * `src/config/index.ts › DESCRIPTION_MAX` (300) with the route's own
 * `.max(DESCRIPTION_MAX)` on `excerpt` and `.max(300)` on `section` and `title`;
 * and `src/app/api/knowledge/bases/[baseId]/files/route.ts › MAX_BODY_BYTES`
 * (1 MB) with `KB_INPUT_SHAPE.body`'s `.max(1_048_576)`. ⚠ A number quoted in a
 * refusal that UNDERCUTS the real bound refuses a legal write and tells the
 * agent to shorten something that already fitted — so if either moves, move
 * this. `knowledge-validation.test.ts` is where the pair is pinned.
 */
const KB_TEXT_FIELD_MAX = 300;
const MB_LIMIT_CHARS = 1_048_576;

/**
 * True for a 400 schema-validation failure
 * (`{ error: { code: "VALIDATION_FAILED", details } }`). ⚠ Duck-typed to work
 * across the @dopl/client boundary without importing the error class.
 */
function isValidationError(
  e: unknown
): e is { status: number; code: string; details: unknown } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 400 &&
    (e as { code?: unknown }).code === "VALIDATION_FAILED"
  );
}

/** Field names named by a validation error's zod-issue `details` array. */
function validationFields(details: unknown): Set<string> {
  const fields = new Set<string>();
  if (Array.isArray(details)) {
    for (const issue of details) {
      const path = (issue as { path?: unknown }).path;
      const first = Array.isArray(path) ? path[0] : undefined;
      if (typeof first === "string") fields.add(first);
    }
  }
  return fields;
}

/**
 * Bidi / directional-formatting control chars the name schema rejects as
 * anti-spoofing: embeddings + overrides (U+202A–U+202E), isolates
 * (U+2066–U+2069), LTR/RTL marks (U+200E/U+200F), Arabic letter mark (U+061C).
 * ⚠ Built from numeric code points, not a regex literal, so the source stays
 * pure-ASCII with no raw bidi controls sitting invisibly in this file.
 */
const BIDI_CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x200e, 0x200f],
  [0x061c, 0x061c],
];

const BIDI_CONTROL_RE = new RegExp(
  `[${BIDI_CONTROL_RANGES.map(([lo, hi]) =>
    lo === hi
      ? String.fromCodePoint(lo)
      : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`
  ).join("")}]`
);

/** `U+XXXX` for the first bidi control char in `text`, else null. */
function namedBidiChar(text: string): string | null {
  const m = BIDI_CONTROL_RE.exec(text);
  if (!m) return null;
  const cp = m[0].codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * `write_file` validation failure → a message naming field + rule + recovery.
 * Null when unrecognized, so the caller rethrows.
 */
export function writeFileValidationError(e: unknown, title?: string): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  // `path` carries no schema rule (z.string()), so a validation failure here is
  // a title or body-size issue.
  if (fields.has("title") || fields.size === 0) {
    const t = title ?? "";
    const bidi = namedBidiChar(t);
    if (bidi) {
      return err(
        refusal(
          KB_INVALID_FIELD,
          `write_file: field=title carries a disallowed bidirectional control character (${bidi}) — remove it (the block prevents right-to-left path spoofing). Nothing was written.`,
        ),
      );
    }
    if (t.includes("/")) {
      return err(
        refusal(
          KB_INVALID_FIELD,
          `write_file: field=title can't contain '/' — that is the path separator. Put the folders in \`path\` and give the entry a clean title. Nothing was written.`,
        ),
      );
    }
    if (fields.has("title")) {
      return err(
        refusal(
          KB_INVALID_FIELD,
          `write_file: field=title can't carry control or zero-width characters or leading/trailing whitespace. Nothing was written.`,
        ),
      );
    }
  }
  if (fields.has("body")) {
    return err(
      refusal(
        fieldTooLong("body", MB_LIMIT_CHARS),
        `write_file: the body is over 1 MB. Split it into several entries and link them.`,
      ),
    );
  }
  // ⚠ **THE TWO 300-CHAR FIELDS, EACH NAMING ITS OWN RULE (S52, 2026-09-18).**
  // Until this wave both fell through to the generic arm below, which named the
  // field and then printed a **title** rule — so a 301-character excerpt was
  // answered with "titles can't contain '/'", and an agent that shortened its
  // TITLE got the identical refusal a second time. `excerpt` and `section` are
  // bounded by `DESCRIPTION_MAX` and by the route's own `.max(300)`; the number
  // is restated here because this package cannot import `src/config`.
  if (fields.has("excerpt")) {
    return err(
      refusal(
        fieldTooLong("excerpt", KB_TEXT_FIELD_MAX),
        `write_file: the excerpt is the row's one-line summary, not a preview of the body — keep it to one sentence. The BODY was not written either; re-issue the whole call.`,
      ),
    );
  }
  if (fields.has("section")) {
    return err(
      refusal(
        fieldTooLong("section", KB_TEXT_FIELD_MAX),
        `write_file: \`section\` is ONE heading line, copied from ${callRef("kb.outline", {}, { form: "op" })} — not the text to write. Pass the heading in \`section\` and its new content in \`body\`.`,
      ),
    );
  }
  return err(
    `write_file: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}. Titles can't contain '/', control, or zero-width characters.`
  );
}

/**
 * `create_folder` validation failure → a message naming field + rule + recovery.
 *
 * ⚠ **IT DID NOT EXIST UNTIL 2026-09-18 (S52), AND `opCreateFolder` RETHREW
 * RAW.** The folder half of the 300-char pair was the worse of the two: a
 * `description` over its cap reached the agent as an unhandled
 * `VALIDATION_FAILED` with no field, no number and no remedy — the shape this
 * whole family of mappers exists to prevent. ⚠ The NAME rule is the folder path's
 * leaf, so the remedy names the path and not "the name field", which no caller
 * of this op passes.
 */
export function createFolderValidationError(e: unknown): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  if (fields.has("description")) {
    return err(
      refusal(
        fieldTooLong("description", KB_TEXT_FIELD_MAX),
        `create_folder: the description is the folder's one-line routing summary shown in get_tree / list_dir. Nothing was created.`,
      ),
    );
  }
  if (fields.has("name") || fields.has("path")) {
    return err(
      refusal(
        KB_INVALID_FIELD,
        `create_folder: each segment of \`path\` becomes a folder name, so no segment may be blank or carry control or zero-width characters. Nothing was created.`,
      ),
    );
  }
  return err(
    refusal(
      KB_INVALID_FIELD,
      `create_folder: the request failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}. Nothing was created.`,
    ),
  );
}

/**
 * `update_base` validation failure → a message naming field + rule + recovery.
 * Null when unrecognized, so the caller rethrows.
 */
export function updateBaseValidationError(e: unknown): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  if (fields.has("slug")) {
    return err(
      `update_base: slug must match ^[a-z0-9-]+$ — lowercase letters, digits, and hyphens only (no leading/trailing hyphen, no spaces).`
    );
  }
  if (fields.has("name")) {
    return err(`update_base: name can't be blank — pass a non-empty name, or omit it to leave the name unchanged.`);
  }
  if (fields.has("description")) {
    return err(`update_base: description is too long.`);
  }
  return err(
    `update_base: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}.`
  );
}

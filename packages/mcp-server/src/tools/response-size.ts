/**
 * RESPONSE SIZE AS THE AGENT'S JOB — ⚠ **the three knobs, declared once**
 * (A14, 2026-09-02).
 *
 * ⚠ WHY THIS IS A PRODUCT DECISION AND NOT A CONVENIENCE. Every one of the
 * three production servers in Samuel's reference tells the caller how to spend
 * less context and assumes it WILL: *"Specify the minimum set of properties
 * needed"*, *"set page_size and max_highlight_length as low as you can"*, *"Set
 * to false to reduce response size"*. Most homegrown MCP tools do the opposite
 * and return everything. This surface returns pre-rendered text, so the caller
 * cannot project it after the fact — if the tool does not offer the knob, the
 * whole page is spent whether the agent needed it or not.
 *
 * ⚠ **`concise` DROPS METADATA, NEVER CONTENT**, and that line is what makes it
 * safe to reach for. The live Slack probe measured the same split: `detailed`
 * carries a per-message header, a timestamp line, thread and reaction lines;
 * `concise` carries `Name <email>: body [ts]` and nothing else, ~25% smaller
 * because the BODY dominates. An agent that suspects `concise` might hide the
 * answer will never use it, so the guarantee has to be absolute: identical
 * bodies, fewer lines ABOUT them.
 *
 * ⚠ AND NONE OF THE THREE IS A SERVER PARAMETER. They are applied in the
 * RENDERERS, where the text is assembled — the loopback payload is internal and
 * costs the agent nothing, while the rendered page is the only thing that
 * reaches its context. Adding a wire parameter would move a cost that was never
 * the agent's, and would put a knob on a contract two clients mirror.
 */

import { z } from "zod";

/** The two levels. ⚠ `detailed` is the DEFAULT — an omitted knob changes nothing. */
export type ResponseFormat = "concise" | "detailed";

/**
 * ⚠ THE ONE `.describe()` FOR THE KNOB, SHARED BY EVERY TOOL THAT TAKES IT.
 * Five tools declaring five wordings is five chances for one of them to promise
 * something `concise` does not do — and the promise ("bodies are untouched") is
 * the entire reason an agent would trust it.
 *
 * ⚠ IT NAMES ITS OPS, and `channel-schema-budget.test.ts › every declared field
 * still names at least one op that takes it` is why: a param an agent cannot
 * tell WHERE to send is a param it sends everywhere. The list is the UNION
 * across the tools that take the field — one wording is the whole point — so a
 * tool that does not publish one of these ops simply never sees it named.
 */
export const RESPONSE_FORMAT_FIELD = z
  .enum(["concise", "detailed"])
  .optional()
  .describe(
    'op="read" / "status" / "read_file" / "search": "concise" drops METADATA — timestamps, ids, scope notes, legends — never a body or a count. Default "detailed"; set it as low as you can.',
  );

/** True when this call asked for the smaller render. */
export function isConcise(format: ResponseFormat | undefined): boolean {
  return format === "concise";
}

/**
 * ⚠ THE ONE `.describe()` FOR THE FIELD-SELECTION KNOB. Same argument as
 * {@link RESPONSE_FORMAT_FIELD}: one wording, so no tool can promise a
 * projection a renderer does not do.
 *
 * 🔒 **`id` IS NOT LISTABLE AND NOT OMITTABLE** (Samuel's ruling, wave B). It is
 * included BY CONSTRUCTION on every row, so it is not one of the names — a
 * caller cannot ask for it and cannot drop it. A roster row whose id can be
 * projected away is a roster row nothing else in the product can address.
 */
export const FIELDS_FIELD = z
  .string()
  .max(200)
  .optional()
  .describe(
    'op="list": comma-separated subset of `name,role,status,teams` to render — the user id is always included and is not one of these. Omit for every field; ask for the fewest you need.',
  );

/**
 * ⚠ THE ONE `.describe()` FOR THE BODY CLIP. It names the op that takes it and
 * the fact that makes it safe: the render SAYS when it clipped
 * ({@link clipToMaxChars}), so a prefix can never be mistaken for a whole.
 */
export const MAX_CHARS_FIELD = z
  .number()
  .int()
  .min(200)
  .max(200_000)
  .optional()
  .describe(
    'op="get": clip the INSTRUCTIONS body to this many characters. The result says it clipped and by how much; omit for the whole document.',
  );

/**
 * ⚠ THE FIELD-SELECTION KNOB, for the surfaces whose ROW IS WIDE. A member row
 * carries name, email, role, status, last-active and team chips; an agent
 * looking for one person's role pays for all six on every row. Absent ⇒ every
 * field, which is what the surface did before this existed.
 *
 * ⚠ AN UNKNOWN NAME IS IGNORED, NOT REFUSED. The alternative is a validation
 * error over a cosmetic preference, on a read the agent could have made
 * unfiltered — and a caller that mistypes one of six field names should get the
 * other five rather than nothing.
 */
export function fieldFilter(
  fields: string | undefined,
): ((name: string) => boolean) | null {
  if (!fields) return null;
  const wanted = new Set(
    fields
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean),
  );
  return wanted.size === 0 ? null : (name) => wanted.has(name.toLowerCase());
}

/**
 * ⚠ THE BODY CLIP, AND IT ALWAYS SAYS WHAT IT DID. A clipped document that
 * renders identically to a complete one is the bug this whole surface refuses
 * everywhere else (`ontology-clipped.ts`, `partial-read.ts`): an agent that
 * cannot tell a prefix from a whole will summarize the prefix as the whole.
 *
 * ⚠ THE NOTICE NAMES THE ARGUMENT THAT WOULD HAVE AVOIDED IT, because "this was
 * truncated" without "raise max_chars" is a dead end the agent cannot act on.
 *
 * @returns the body (clipped or not) and the notice, or `null` for no notice.
 */
export function clipToMaxChars(
  body: string,
  maxChars: number | undefined,
): { body: string; notice: string | null } {
  if (maxChars === undefined || body.length <= maxChars) {
    return { body, notice: null };
  }
  return {
    body: body.slice(0, maxChars),
    notice: `⚠ CLIPPED to max_chars=${maxChars} of ${body.length} characters — this is a PREFIX, not the document. Raise \`max_chars\` or omit it for the whole body.`,
  };
}

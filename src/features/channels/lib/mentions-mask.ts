/**
 * WHAT IS NOT A TAGGABLE WORD — the masking half of the ONE @-mention parser.
 * The MATCH RULE (what a handle is, and who it names) is `mentions.ts`.
 *
 * ⚠ SPLIT OUT OF `mentions.ts` ON 2026-08-22, when that file crossed the
 * 500-line cap adding the markup masks (INVARIANTS §1: a file at 500 cannot
 * absorb a COMMENT, so the fix is a split, not a shorter docblock). ⚠ THE SEAM
 * IS A REASON TO CHANGE, not a line count: this file moves when MARKDOWN's
 * structure does — a delimiter, an escape, a destination syntax — and
 * `mentions.ts` moves when the HANDLE derivation does. Neither reason has ever
 * fired for both.
 *
 * ⚠ RE-EXPORTED THROUGH `mentions.ts`, so every existing import is unchanged.
 * Import either; do not create a third path to the same symbol (the precedent is
 * `schema-collab.ts` re-exported through `schema.ts`).
 *
 * ⚠ EVERY MASK BLANKS AND NEVER DELETES — same length, spaces in place. Two
 * reasons, both load-bearing: a blank cannot FUSE the text on either side of a
 * region into a new token (deleting a span out of `@di` + a code span + `ana`
 * leaves `@diana` and tags somebody the body never named), and a space is
 * exactly what `MENTION_TOKEN_RE` treats as a token boundary, so a masked region
 * cannot contribute to a neighbouring token either.
 *
 * Code is QUOTED TEXT. A handle written as an example — in a doc, in a snippet,
 * in a `@handle` the author is explaining rather than using — is not somebody
 * asking for a person. ⚠ This was measured, not theorised: two agents writing
 * documentation about @-tagging put backticked handles in their bodies and
 * TAGGED BOTH OPERATORS for real (channel seqs 647 / 653, 2026-08-21). Nothing
 * was addressed, nothing was asked; two humans got inbox items out of prose
 * about the feature.
 *
 * ⚠ THE RENDERER ALREADY OBEYED IT, WHICH IS THE WHOLE POINT. `message-markdown.tsx`
 * (rule 3, and its `codespan` arm) deliberately does NOT tint inside code:
 * `marked` lexes a code span / fence into its own token and {@link MENTION_TOKEN_RE}
 * is never run over it, so the tint is structurally impossible there
 * (`message-markdown.test.tsx › does NOT tint one inside a code span`). Until this
 * rule landed, the SERVER disagreed with that: it stamped a tag the transcript
 * would not draw — the two-ends-disagree failure this module exists to prevent,
 * and in the worse direction, because the stamp is what the Tags inbox reads.
 *
 * ⚠ IT IS STATED HERE RATHER THAN IN THE SERVER RESOLVER because both readers
 * have to mean the same thing by "in code", and only one of them lexes markdown.
 * The renderer inherits the rule from `marked`'s structure; the server inherits
 * it from {@link maskCodeRegions}. The rule is written down exactly once — here.
 * A copy of the masker in `server/service-writes-metadata-mentions.ts` would be
 * the second parser this file's opening warning is about.
 *

/**
 * A fence line: up to three spaces of indent, then three or more backticks or
 * three or more tildes. ⚠ The opening line is masked WITH its body — an info
 * string is code's own metadata (```` ```@diana ```` is a language tag, not a
 * tag), and the renderer prints it nowhere.
 */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * THE BODY WITH EVERY CODE REGION BLANKED, character for character, so offsets
 * are unchanged and the caller can tokenize the result as if it were the body.
 *
 * ⚠ SPACES, NOT DELETION. A blank of the same length cannot fuse the text on
 * either side of a span into a new token: `x`@`y` must not become `@`. Space is
 * also exactly what {@link MENTION_TOKEN_RE} treats as a token boundary, so a
 * masked region cannot contribute to a neighbouring token either.
 *
 * TWO REGIONS, in the order `marked` resolves them:
 *  1. FENCED BLOCKS win, and they win first — a fence's interior is code
 *     whatever backticks it contains, so scanning inline spans first would let
 *     an odd backtick inside a fence swallow real prose after it. Closed by a
 *     fence of the SAME character and at least the same length; an UNCLOSED
 *     fence runs to the end of the body (CommonMark, and the renderer's `marked`
 *     agrees) — which is the fail-CLOSED direction here: an unterminated fence
 *     tags nobody rather than tagging everything below it.
 *  2. INLINE SPANS over what is left: a run of N backticks opens, and the next
 *     run of EXACTLY N closes it. An unmatched run is literal text and masks
 *     nothing, so a lone backtick in prose never eats the rest of the line.
 *
 * ⚠ INDENTED (four-space) CODE BLOCKS ARE DELIBERATELY NOT MASKED. `marked`
 * treats them as code, so a handle in one is not tinted while the server still
 * tags it — the two ends disagree in that one shape.
 *
 * ⚠ THAT IS THE SAME DIRECTION THE HEADER CALLS THE WORSE ONE, and this docblock
 * called it "the SAFE way round" until 2026-08-22. Both readings were defensible
 * about DIFFERENT harms and neither is the settled answer: an unstamped tint lies
 * to the AUTHOR (they believe someone was told), a tintless stamp lies to the
 * RECIPIENT (an inbox item nobody meant to send) — and the incident that bought
 * this whole rule, seqs 647 / 653, was the SECOND kind. Do not quote either half
 * as "the safe direction" to justify a change.
 *
 * What actually justifies leaving indentation alone is the COST of the
 * alternative, not its direction: masking would mean deciding whether an indented
 * line is code or a wrapped bullet with no block context, and a chat body
 * indenting a line of prose is common enough that guessing costs real tags. If
 * this ever matters, it is a case for lexing with `marked` here, not for a fourth
 * indentation heuristic.
 */
export function maskCodeRegions(body: string): string {
  const blank = (text: string): string => " ".repeat(text.length);
  const lines = body.split("\n");
  let openFence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE_LINE.exec(lines[i]);
    if (openFence === null) {
      if (match) openFence = match[1];
      else continue;
    } else if (
      match &&
      match[1][0] === openFence[0] &&
      match[1].length >= openFence.length
    ) {
      openFence = null;
    }
    lines[i] = blank(lines[i]);
  }
  const masked = lines.join("\n");
  // ⚠ Runs the SPAN pass over the fenced-masked text: a fence's interior is now
  // spaces, so its backticks cannot open a span across the rest of the body.
  //
  // ⚠ A SPAN MAY NOT CROSS A BLANK LINE (the `(?!\n[ \t]*\n)` guard). `marked`
  // lexes INLINE tokens inside one block, so a stray backtick in the first
  // paragraph and another three paragraphs down are two literal characters
  // there — while an unguarded lazy match would read them as one span and blank
  // everything between, silently eating real tags in the middle.
  return masked.replace(
    /(`+)(?:(?!\n[ \t]*\n)[\s\S])*?\1/g,
    (whole) => blank(whole)
  );
}

/** A backslash run immediately before an `@`. Odd run = the last one escapes it. */
const ESCAPED_AT = /\\+@/g;

/**
 * An inline link or image DESTINATION, `](…)`. ⚠ Non-greedy to the first `)` and
 * never across a newline: a destination holding balanced parens is rare, and the
 * failure direction of stopping early is "mask less", which costs a tag rather
 * than inventing one.
 */
const LINK_DESTINATION = /\]\([^)\n]*\)/g;

/** A link REFERENCE DEFINITION line, `[label]: destination`. Whole line, because
 *  `marked` absorbs one into its link table and renders NOTHING for it. */
const LINK_REFERENCE_DEF = /^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm;

/**
 * THE SECOND MASK: text markdown treats as MARKUP rather than as words, blanked
 * on {@link maskCodeRegions}'s exact terms (same length, spaces not deletion).
 *
 * ⚠ EACH ENTRY IS A MEASURED DISAGREEMENT WITH THE TINT, not a guess about what
 * "looks like" a mention (F-266; re-measured 2026-08-22 by walking `marked` the
 * way `message-markdown.tsx` walks it and collecting every string that reaches
 * `MentionText`):
 *
 *  1. AN ESCAPED `\@` — the transcript does NOT tint it (`marked` emits an
 *     `escape` token carrying the bare `@`, so the leaf `MentionText` sees is
 *     `"@"` with the handle in a SEPARATE leaf, and a lone `@` is not a token),
 *     and the server tagged it. **The author typed the backslash precisely to
 *     avoid tagging and got tagged anyway** — the worst direction available.
 *     ⚠ THE BACKSLASH RUN IS COUNTED. `\\@diana` is an escaped BACKSLASH followed
 *     by a live mention; only an ODD run escapes the `@`. Blanking on sight would
 *     silently drop a real tag.
 *  2. A LINK OR IMAGE DESTINATION — `[docs](https://ex.com/@diana)` tinted
 *     nothing and tagged Diana, because a destination never reaches `MentionText`
 *     at all. ⚠ THE SAME MASK FIXES THE OPPOSITE CASE FOR FREE, which is why it
 *     is a mask rather than a token rule: link TEXT (`[@diana](url)`) DOES tint,
 *     and its token was `@diana](url` — blanking the destination leaves exactly
 *     `@diana`, so both halves of a markdown link now agree with the render.
 *  3. A LINK REFERENCE DEFINITION — `marked` absorbs the line into its link table
 *     and renders nothing, so nothing tinted while the server tagged the URL.
 *
 * ⚠ AUTOLINKS ARE DELIBERATELY ABSENT, AND THAT IS A CORRECTION TO THE BRIEF.
 * `<https://ex.com/@diana>` and a bare `https://ex.com/@diana` both become `link`
 * tokens whose `tokens` ARE the url text, so `MessageLink` renders that text
 * through `MentionText` and the transcript **tints them today**. Masking them
 * would stamp nothing under a visible highlight — manufacturing the exact
 * divergence this change exists to remove. They already agree; leave them.
 */
export function maskMarkupRegions(body: string): string {
  const blank = (text: string): string => " ".repeat(text.length);
  return body
    .replace(ESCAPED_AT, (run) => {
      const slashes = run.length - 1;
      // Odd run: the final `\` escapes the `@`, so that PAIR stops being one.
      // Even: every backslash is itself escaped and the `@` is live prose.
      return slashes % 2 === 1 ? run.slice(0, slashes - 1) + "  " : run;
    })
    .replace(LINK_REFERENCE_DEF, blank)
    .replace(LINK_DESTINATION, blank);
}

/**
 * THE ONE FUNNEL: everything that is not a taggable word, blanked.
 *
 * ⚠ CODE FIRST, ALWAYS. A fence's interior is code whatever it contains, so a
 * `\@` or a `](…)` inside one must already be spaces before the markup pass runs
 * — otherwise the markup regexes would be matching against text that is not
 * prose, and an unbalanced bracket in a code sample could blank real words after
 * the fence.
 */
export function maskNonTaggingRegions(body: string): string {
  return maskMarkupRegions(maskCodeRegions(body));
}

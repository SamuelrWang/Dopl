/**
 * THE TWO PREDICATES, HELD AGAINST EACH OTHER (F-266, 2026-08-22).
 *
 * `lib/mentions.ts` is called "one parser" and it is — but it is consumed by two
 * DIFFERENT predicates. The server masks text and tokenizes it. The transcript
 * (`components/channels-v2/message-markdown.tsx`) never masks anything: `marked`
 * lexes the body and `MentionText` runs the token regex on whatever survives in a
 * `text` / `escape` leaf. Everything markdown does in between — emphasis, links,
 * escapes, inline HTML — decides which of them sees a handle at all.
 *
 * ⚠ EACH SIDE HAD A TEST AND NEITHER HAD THIS ONE, which is exactly how the
 * defect shipped. `message-markdown.test.tsx › tints one inside a bold run…`
 * pinned `**@dianataylor**` as a tinted link; `mentions.test.ts` pinned the
 * resolver. Both were green while a bold escalation showed a highlight and
 * stamped an empty set — **an agent writing `**@sam** I am blocked` was told by
 * the transcript that it had reached its operator, and the Tags inbox was
 * empty.** Two suites agreeing with themselves is not the same as the two ends
 * agreeing with each other.
 *
 * ⚠ IT WALKS `marked` RATHER THAN RENDERING REACT, deliberately. The question is
 * "which strings reach `MentionText`", which is a LEXER question; mounting the
 * component would drag in the DOM, the design tokens and the link policy to
 * answer it, and would pin `message-markdown.tsx`'s markup as a side effect —
 * that file belongs to another lane and this test must not constrain its
 * rendering. {@link mentionLeaves} mirrors its token walk and nothing else.
 *
 * ⚠ SO IT CAN GO STALE IN ONE WAY: if `message-markdown.tsx` starts or stops
 * routing a token type through `MentionText`, this walk must follow. The
 * `TOKEN ARMS` case below is the tripwire — it asserts the arms this mirror
 * models against the ones that file actually has, by reading its source.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { marked, type Token, type Tokens } from "marked";
import {
  MENTION_TOKEN_RE,
  buildMentionIndex,
  resolveMentionToken,
  resolveMentions,
  type MentionCandidate,
} from "./mentions";

const DIANA: MentionCandidate = {
  userId: "u-diana",
  displayName: "Diana Taylor",
  email: "diana@example.com",
};
const ROSTER = [DIANA];

/**
 * Every string `message-markdown.tsx` hands to `MentionText`, in order.
 *
 * ⚠ THE ARMS THAT PUSH NOTHING ARE THE POINT, not omissions: `code` and
 * `codespan` render their own text (rule 3 — code is quoted), `html` renders its
 * `raw` in a bare span, `image` renders a label, and the `default` arm renders
 * `token.raw` as INERT text. None of those five reaches the mention leaf, so a
 * handle inside one cannot tint.
 */
function mentionLeaves(tokens: Token[] | undefined, out: string[] = []): string[] {
  if (!tokens) return out;
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens) mentionLeaves(t.tokens, out);
        else out.push(t.text);
        break;
      }
      case "escape":
        out.push((token as Tokens.Text).text);
        break;
      case "paragraph":
      case "heading":
      case "strong":
      case "em":
      case "del":
        mentionLeaves((token as { tokens?: Token[] }).tokens, out);
        break;
      case "blockquote":
        mentionLeaves((token as Tokens.Blockquote).tokens, out);
        break;
      case "list":
        for (const item of (token as Tokens.List).items) mentionLeaves(item.tokens, out);
        break;
      // ⚠ A LINK'S TEXT REACHES THE LEAF; ITS DESTINATION NEVER DOES. That
      // asymmetry is the whole of cases 2 and 3 in `maskMarkupRegions`.
      case "link":
        mentionLeaves((token as Tokens.Link).tokens, out);
        break;
      case "table": {
        const t = token as Tokens.Table;
        for (const cell of t.header) mentionLeaves(cell.tokens, out);
        for (const row of t.rows) for (const cell of row) mentionLeaves(cell.tokens, out);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Does the TRANSCRIPT draw a tint for a roster member in this body? */
function tints(body: string): boolean {
  const index = buildMentionIndex(ROSTER);
  const leaves = mentionLeaves(marked.lexer(body, { gfm: true, breaks: false }));
  return leaves.some((leaf) =>
    leaf
      .split(MENTION_TOKEN_RE)
      .some((part) => part.startsWith("@") && resolveMentionToken(part, index) !== null)
  );
}

/** Does the SERVER stamp anybody for this body? */
function stamps(body: string): boolean {
  return resolveMentions(body, ROSTER).length > 0;
}

/**
 * ⚠ EVERY ROW IS A MEASUREMENT TAKEN AGAINST THE SHIPPING RENDERER, and the
 * `tag` column says what BOTH ends must do — not what one of them happened to do
 * before the fix. Ten of these disagreed on 2026-08-22 and are listed in F-266.
 */
const CASES: ReadonlyArray<{ name: string; body: string; tag: boolean }> = [
  // ── The emphasis family: WRAPPED, so the delimiters come off and it tags ────
  { name: "bold **",              body: "**@diana** please review",              tag: true },
  { name: "em *",                 body: "*@diana* please review",                tag: true },
  { name: "bold __",              body: "__@diana__ please review",              tag: true },
  { name: "em _",                 body: "_@diana_ please review",                tag: true },
  { name: "strike ~~",            body: "~~@diana~~ please review",              tag: true },
  { name: "bold + punctuation",   body: "**@diana**, please review",             tag: true },
  { name: "bold squashed handle", body: "**@dianataylor** please",               tag: true },
  { name: "inline html",          body: "<b>@diana</b> please",                  tag: true },
  // ── Markup, not words: blanked, so it tags nobody ──────────────────────────
  { name: "escaped @",            body: "literally \\@diana here",               tag: false },
  { name: "escaped backslash",    body: "a backslash \\\\@diana here",           tag: true },
  { name: "link destination",     body: "see [docs](https://ex.com/@diana)",     tag: false },
  { name: "image destination",    body: "![alt](https://ex.com/@diana)",         tag: false },
  { name: "link reference def",   body: "[docs]: https://ex.com/@diana",         tag: false },
  // ⚠ The mask that removes the DESTINATION is what lets the TEXT resolve.
  { name: "link text",            body: "[@diana](https://ex.com) please",       tag: true },
  // ── Code (the 2026-08-22 rule) ─────────────────────────────────────────────
  { name: "code span",            body: "write `@diana` to tag",                 tag: false },
  { name: "fence",                body: "```\n@diana\n```",                      tag: false },
  // ── Already agreed, and must keep agreeing ────────────────────────────────
  { name: "plain",                body: "@diana please review",                  tag: true },
  { name: "heading",              body: "## @diana ping",                        tag: true },
  { name: "bullet",               body: "- @diana ping",                         tag: true },
  { name: "blockquote",           body: "> @diana ping",                         tag: true },
  { name: "table cell",           body: "| a |\n|---|\n| @diana |",              tag: true },
  { name: "angle autolink",       body: "see <https://ex.com/@diana>",           tag: true },
  { name: "bare autolink",        body: "see https://ex.com/@diana now",         tag: true },
  // ⚠ NOT a near-miss: `[^\s@]+` stops at the second `@`, so the only token here
  // is `@example.com`, which no roster member answers to. Both ends say nobody
  // and they say it for the same reason (`mentions.test.ts › does not treat an
  // email in prose as two tags`).
  { name: "email in prose",       body: "mail diana@example.com",                tag: false },
];

describe("the tint and the stamp answer the same question", () => {
  for (const { name, body, tag } of CASES) {
    it(`${name}: both ${tag ? "TAG" : "tag NOBODY"}`, () => {
      expect({ tint: tints(body), stamp: stamps(body) }).toEqual({
        tint: tag,
        stamp: tag,
      });
    });
  }

  it("the harness can SEE a divergence — a parity test that cannot fail is not a guard", () => {
    // Red proof, on the exact defect this file was written for: with `*` back
    // out of the trailing class, `**@diana**` tints and stamps nobody.
    const index = buildMentionIndex(ROSTER);
    expect(resolveMentionToken("@diana**", index)).toBe("u-diana");
    expect(resolveMentionToken("@diana**".replace(/\*+$/, "x"), index)).toBeNull();
  });
});

describe("what this table deliberately leaves out", () => {
  it("INDENTED code is the one known gap, and it is excluded BY NAME", () => {
    // ⚠ `marked` calls a four-space block code and does not tint; the masker
    // does not model it and the server tags. Left alone deliberately — deciding
    // whether an indented line is code or a wrapped bullet needs block context,
    // and a chat body indenting prose is common enough that guessing costs real
    // tags. Asserted so the gap stays VISIBLE: if it ever closes, this fails and
    // the row moves into the table above.
    const body = "para\n\n    @diana\n";
    expect(tints(body)).toBe(false);
    expect(stamps(body)).toBe(true);
  });
});

describe("TOKEN ARMS — the tripwire on this mirror going stale", () => {
  /**
   * ⚠ THIS TEST IS ABOUT THE OTHER FILE, and it is the reason walking `marked`
   * here is safe. {@link mentionLeaves} models which token types reach
   * `MentionText`; if `message-markdown.tsx` adds or removes one, this mirror
   * silently starts answering a different question than the renderer does, and
   * every parity case above would keep passing while meaning nothing.
   */
  const source = readFileSync(
    path.resolve(
      __dirname,
      "..",
      "components",
      "channels-v2",
      "message-markdown.tsx"
    ),
    "utf8"
  );

  it("the arms that DO reach MentionText are the ones this mirror walks", () => {
    // Two call sites in that file: the `text` block arm and the inline
    // `text`/`escape` arm. A third would be a token type this mirror ignores.
    const calls = source.match(/<MentionText/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(source).toContain(`case "escape":`);
  });

  it("code and codespan still render their own text, never the mention leaf", () => {
    // The code rule is structural on that side (INVARIANTS §5). If either arm
    // started routing through MentionText, the masker here would be masking a
    // region the transcript had begun to tint.
    expect(source).toContain("NO MENTION TINT INSIDE CODE");
    expect(source).toContain(`{(token as Tokens.Codespan).text}`);
  });
});

"use client";

/**
 * Channels v2 — A MESSAGE BODY, RENDERED AS MARKDOWN (Samuel, 2026-08-21).
 *
 * Bodies arrived as raw text and read as raw text: an agent's `**bold**` and its
 * fenced code blocks printed their own asterisks and backticks. This is the
 * renderer, and the two rules below are the whole design.
 *
 * ⚠ 1. THE BODY IS UNTRUSTED AND NO HTML EVER REACHES THE DOM AS MARKUP.
 * Other members and their agents author these strings. There is no
 * `dangerouslySetInnerHTML` on this path and there is no sanitizer to keep in
 * step with an attacker, because **no HTML string is ever produced**: the
 * markdown is LEXED to tokens and the tokens are mapped to React elements, so
 * every node in the output is one this file constructed. `html` tokens — block
 * and inline — render as their own LITERAL TEXT (`<script>…` prints as those
 * characters), which is the honest rendering of "somebody typed HTML at me".
 *
 * ⚠ 2. THE PARSER IS `marked`, ALREADY A DEPENDENCY OF THIS TREE. It is the
 * repo's markdown engine (`shared/editor/doc-editor.tsx` runs the KB's entries
 * through it on the way into Tiptap). **`marked.lexer` is used, never
 * `marked.parse`** — `parse` is the HTML-string path rule 1 forbids. Nothing new
 * was installed: `react-markdown` would have brought ~40 transitive packages
 * into a bundle the desktop ships, to reach a token tree this one already
 * produces, and the mention tint below would still have had to be written as a
 * remark plugin plus a custom hast node.
 *
 * ⚠ 3. MENTIONS TINT AT THE TEXT LEAF, WHICH IS WHY THEY SURVIVE MARKDOWN. Every
 * inline `text` token — inside a heading, a list item, a bold run, a blockquote,
 * anywhere — is split by {@link MentionText}. A token cannot be broken by
 * markdown structure because it is never matched across one: `**@diana**` tints
 * inside the bold, and a `@handle` inside a code span is deliberately NOT tinted,
 * because code is quoted text and tinting it would claim somebody was tagged by
 * an example.
 *
 * ⚠ 4. NO WRAPPER ELEMENT. The blocks render as a FRAGMENT straight into
 * `transcript.tsx › AuthoredRow`'s column, so each one is a direct child of the
 * flex column that anchors own messages (`items-end`) — a container div here
 * would re-parent every paragraph and quietly break that anchoring. Each block
 * carries the caller's own block recipe instead (`blockClassName`), which is how
 * `wrap-anywhere` and the 92% cap stay on the `<p>` where the layout pins expect
 * them (`transcript-body.test.tsx`).
 *
 * ⚠ 5. LAYOUT AND TYPE ARRIVE AS TWO CLASSES, and no block is ever handed a
 * class it has to WIN against. `blockClassName` is the geometry every block
 * needs; `textClassName` is the body's size and colour, applied only where the
 * body's type is what is wanted. A heading and a code fence set their own and
 * receive neither — because `cn` cannot arbitrate that race: `tailwind-merge`
 * groups this tree's `text-lead` SIZE with the `text-text-primary` COLOUR (a
 * custom `text-*` scale is indistinguishable from a colour by name), so merging
 * them drops one at random-looking. Measured 2026-08-21; `transcript.tsx ›
 * MESSAGE_BLOCK` carries the same note.
 */

import { marked, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
// ⚠ THE LINK POLICY IS ITS OWN FILE since 2026-08-22 (`message-markdown-links.tsx`),
// split on the SECURITY seam rather than an arbitrary cut: the allow-list changes when
// somebody finds a scheme we did not think of, this file when markdown support moves.
import { ExternalAnchor, safeHref } from "./message-markdown-links";
import {
  buildMentionIndex,
} from "../../lib/mentions";
import {
  addressableAgents,
  buildAgentMentionIndex,
} from "../../lib/agent-mentions";
import type { AuthorIndex } from "./view-model";
// ⚠ SPLIT ON THE 500-LINE CAP (2026-09-05): the shared shape and the mention leaf.
import type { BodyContext } from "./message-markdown-context";
import { MentionText } from "./message-markdown-mentions";


export function MessageMarkdown({
  text,
  index,
  mentionsMe,
  blockClassName = "",
  textClassName = "",
}: {
  text: string;
  index: AuthorIndex;
  /** SERVER-STAMPED (`metadata.mentionedUserIds`), never re-derived here. */
  mentionsMe: boolean;
  /** The caller's block GEOMETRY — see rules 4 and 5 above. */
  blockClassName?: string;
  /** The caller's body TYPE — see rule 5. */
  textClassName?: string;
}) {
  const ctx: BodyContext = {
    handles: buildMentionIndex([...index.byId.values()]),
    // ⚠ FROM THE LIVE FEED, so a rename re-tints the same token under a new spelling on the next
    // push. Empty wherever there is no desktop (the web tree, the pop-out) — no tint, no error.
    // ⚠ **REACHABLE AGENTS ONLY** (Samuel, 2026-09-06). The local feed retains ENDED agents for
    // seven days so their cards survive, and while they sat in this index a dead agent's tag
    // tinted exactly like a live one's. `index` itself stays WHOLE — attribution below still
    // names an ended author on its own messages; only the handle namespace narrows.
    agentHandles: buildAgentMentionIndex(addressableAgents(index.agents)),
    index,
    mentionsMe,
    block: blockClassName,
    text: textClassName,
  };
  // ⚠ `lexer`, NEVER `parse`. GFM on for tables / strikethrough / autolinks;
  // `breaks` OFF so the markdown's own line rules hold — a chat body's single
  // newlines still separate blocks through the paragraph tokens themselves.
  const tokens = marked.lexer(text, { gfm: true, breaks: false });
  return (
    <>
      {tokens.map((token, i) => (
        <Block key={i} token={token} ctx={ctx} top />
      ))}
    </>
  );
}

/**
 * Modest, chat-sized headings. A document scale would shout across a
 * transcript, so the two steps are WEIGHT and a small size move inside the
 * existing scale — never a `text-3xl` that turns one message into a banner.
 *
 * ⚠ IT CARRIES ITS OWN COLOUR because it does not receive the body's (rule 5).
 */
function headingClass(depth: number): string {
  return depth <= 2
    ? "text-lead font-semibold text-text-primary"
    : "text-body font-semibold uppercase tracking-wide text-text-secondary";
}

/**
 * One block token.
 *
 * ⚠ `top` IS WHETHER THIS BLOCK IS A DIRECT CHILD OF THE ROW'S COLUMN. Only
 * those wear the caller's geometry: a paragraph nested inside a list item or a
 * blockquote is already inside a capped, anchored box, and capping it again at
 * 92% of its PARENT would step the indent in twice.
 */
function Block({
  token,
  ctx,
  top = false,
}: {
  token: Token;
  ctx: BodyContext;
  top?: boolean;
}): ReactNode {
  const block = top ? ctx.block : "";
  switch (token.type) {
    case "space":
      return null;

    case "paragraph":
      return (
        <p className={cn(block, ctx.text)}>
          <Inline tokens={(token as Tokens.Paragraph).tokens} ctx={ctx} />
        </p>
      );

    case "heading": {
      const t = token as Tokens.Heading;
      return (
        <p className={cn(block, headingClass(t.depth))}>
          <Inline tokens={t.tokens} ctx={ctx} />
        </p>
      );
    }

    case "code": {
      // ⚠ THE ONE BLOCK THAT SCROLLS RATHER THAN WRAPS. Wrapping code changes
      // what it says; `overflow-x-auto` keeps the line intact and reachable.
      // ⚠ AND IT TAKES THE GEOMETRY WITHOUT `wrap-anywhere` — it writes its own
      // cap rather than the caller's, because the caller's carries the wrap rule
      // that would re-flow the very thing this block exists to preserve.
      const t = token as Tokens.Code;
      return (
        <pre
          className={cn(
            top && "max-w-[92%]",
            "overflow-x-auto rounded-[8px] border border-border-default bg-bg-inset px-2.5 py-2"
          )}
        >
          <code className="font-mono text-caption text-text-primary">{t.text}</code>
        </pre>
      );
    }

    case "blockquote": {
      const t = token as Tokens.Blockquote;
      return (
        <blockquote
          className={cn(block, "border-l-2 border-border-strong pl-2.5 text-text-secondary")}
        >
          {t.tokens.map((child, i) => (
            <Block key={i} token={child} ctx={ctx} />
          ))}
        </blockquote>
      );
    }

    case "list": {
      const t = token as Tokens.List;
      const items = t.items.map((item, i) => (
        <li key={i} className={ctx.text}>
          {item.tokens.map((child, j) => (
            <Block key={j} token={child} ctx={ctx} />
          ))}
        </li>
      ));
      return t.ordered ? (
        <ol
          start={typeof t.start === "number" ? t.start : undefined}
          className={cn(block, "list-decimal pl-5")}
        >
          {items}
        </ol>
      ) : (
        <ul className={cn(block, "list-disc pl-5")}>{items}</ul>
      );
    }

    // ⚠ A GFM TASK-LIST MARKER, AND IT MUST NOT BE A BLOCK (2026-08-22, F-252).
    // `marked@18` emits the checkbox as the FIRST CHILD of a `list_item`'s
    // `tokens`, beside the item's own text run — so falling to the `default` arm
    // wrapped it in a `<p>` and broke EVERY checklist item across two lines, with
    // the literal `[ ]` / `[x]` on the first. A `<span>` keeps the marker on the
    // item's line, which is the whole defect.
    // ⚠ IT IS A SYMBOL, NOT AN `<input type="checkbox">`. A real checkbox in a
    // transcript is a control the reader can reach and click, and nothing here
    // writes anything back — `disabled` would then be an inert input, which is
    // the same objection the agent panel's missing composer is built on. The
    // label is REAL rather than `aria-hidden`: done and not-done is the item's
    // meaning, not decoration.
    case "checkbox": {
      const t = token as Tokens.Checkbox;
      return (
        <span
          role="img"
          aria-label={t.checked ? "done" : "not done"}
          className="mr-1 text-text-secondary"
        >
          {t.checked ? "☑" : "☐"}
        </span>
      );
    }

    // A list item's own inline run arrives as a `text` token carrying `tokens`;
    // a LOOSE item arrives as paragraphs and lands above instead. ⚠ Nested, it
    // renders bare so the run stays on the item's own line; at the TOP level it
    // needs a block of its own, or it would sit unwrapped in a flex column and
    // become its own row.
    case "text": {
      const t = token as Tokens.Text;
      const run = t.tokens ? (
        <Inline tokens={t.tokens} ctx={ctx} />
      ) : (
        <MentionText text={t.text} ctx={ctx} />
      );
      return top ? <p className={cn(block, ctx.text)}>{run}</p> : run;
    }

    case "table": {
      const t = token as Tokens.Table;
      return (
        <div className={cn(block, "overflow-x-auto")}>
          <table className="w-full border-collapse text-body text-text-primary">
            <thead>
              <tr>
                {t.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-border-default px-2 py-1 text-left font-semibold"
                  >
                    <Inline tokens={cell.tokens} ctx={ctx} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b border-border-subtle px-2 py-1 align-top">
                      <Inline tokens={cell.tokens} ctx={ctx} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "hr":
      return <hr className="border-t border-border-subtle" />;

    // ⚠ RULE 1, AT THE BLOCK LEVEL. The author's characters, as characters.
    case "html":
      return <p className={cn(block, ctx.text)}>{(token as Tokens.HTML).raw}</p>;

    default:
      // ⚠ AN UNHANDLED TOKEN RENDERS ITS OWN SOURCE, never nothing. `marked`
      // can tokenize something this switch has not met (a footnote, a def);
      // dropping it would silently delete a member's words.
      return (
        <p className={cn(block, ctx.text)}>
          {("raw" in token ? token.raw : "") as string}
        </p>
      );
  }
}

function Inline({ tokens, ctx }: { tokens?: Token[]; ctx: BodyContext }): ReactNode {
  if (!tokens) return null;
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "text":
          case "escape":
            return <MentionText key={i} text={(token as Tokens.Text).text} ctx={ctx} />;
          case "strong":
            return (
              <strong key={i} className="font-semibold">
                <Inline tokens={(token as Tokens.Strong).tokens} ctx={ctx} />
              </strong>
            );
          case "em":
            return (
              <em key={i} className="italic">
                <Inline tokens={(token as Tokens.Em).tokens} ctx={ctx} />
              </em>
            );
          case "del":
            return (
              <del key={i} className="line-through">
                <Inline tokens={(token as Tokens.Del).tokens} ctx={ctx} />
              </del>
            );
          case "codespan":
            // ⚠ NO MENTION TINT INSIDE CODE, on purpose (rule 3): a handle in a
            // code span is a quoted example, and tinting it would claim
            // somebody was tagged by it.
            return (
              <code
                key={i}
                className="rounded-[4px] border border-border-subtle bg-bg-inset px-1 py-px font-mono text-caption"
              >
                {(token as Tokens.Codespan).text}
              </code>
            );
          case "br":
            return <br key={i} />;
          case "link":
            return <MessageLink key={i} token={token as Tokens.Link} ctx={ctx} />;
          case "image": {
            // ⚠ NO REMOTE IMAGE IS LOADED FROM A MESSAGE BODY. An `<img>` whose
            // src an author chooses is a read receipt and an IP disclosure for
            // every member who scrolls past it, fetched before anybody decided
            // to look. The link is offered instead, so nothing is hidden and
            // nothing is fetched until it is clicked.
            const t = token as Tokens.Image;
            const href = safeHref(t.href);
            const label = t.text || t.title || "image";
            return href ? (
              <ExternalAnchor key={i} href={href}>
                {label}
              </ExternalAnchor>
            ) : (
              <span key={i}>{label}</span>
            );
          }
          // ⚠ RULE 1, AT THE INLINE LEVEL.
          case "html":
            return <span key={i}>{(token as Tokens.HTML).raw}</span>;
          default:
            return <span key={i}>{("raw" in token ? token.raw : "") as string}</span>;
        }
      })}
    </>
  );
}

/** A markdown link, or — when its href is not one this surface will follow — the
 *  link's own TEXT, so the words survive even though the destination does not. */
function MessageLink({ token, ctx }: { token: Tokens.Link; ctx: BodyContext }) {
  const href = safeHref(token.href);
  if (!href) return <Inline tokens={token.tokens} ctx={ctx} />;
  return (
    <ExternalAnchor href={href} title={token.title ?? undefined}>
      <Inline tokens={token.tokens} ctx={ctx} />
    </ExternalAnchor>
  );
}


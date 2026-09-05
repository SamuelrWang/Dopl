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
  MENTION_TOKEN_RE,
  buildMentionIndex,
  mentionHandleOf,
  resolveMentionToken,
} from "../../lib/mentions";
import {
  agentMentionFace,
  buildAgentMentionIndex,
  resolveAgentHandle,
  type AgentMentionIndex,
} from "../../lib/agent-mentions";
import type { AuthorIndex } from "./view-model";

/** What every leaf and block needs: the roster, whether this row tags me, and
 *  the caller's two class halves (rules 4 and 5). */
interface BodyContext {
  handles: ReturnType<typeof buildMentionIndex>;
  /** MY OWN agents' handles (`lib/agent-mentions.ts`). ⚠ A SEPARATE NAMESPACE from the roster's —
   *  it decides TINT ONLY and never reaches `metadata.mentionedUserIds`. */
  agentHandles: AgentMentionIndex;
  index: AuthorIndex;
  mentionsMe: boolean;
  /** Geometry every block wears. */
  block: string;
  /** The body's size + colour — only on blocks that want the body's type. */
  text: string;
}

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
    agentHandles: buildAgentMentionIndex(
      [...index.agents.entries()].map(([agentId, identity]) => ({
        agentId,
        displayName: identity.displayName,
      }))
    ),
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

/**
 * ONE TEXT LEAF, with roster-resolved @-mentions tinted and a mention OF THE
 * VIEWER additionally tinted — these are the rows the Tags inbox points at, and
 * they should be findable by eye once a scroll lands nearby.
 *
 * ⚠ MOVED HERE FROM `transcript.tsx › Body` (2026-08-21) UNCHANGED IN RULE. It
 * used to be the whole body renderer, splitting one line; it is now the LEAF the
 * markdown renderer calls at every text node, which is what makes a mention
 * inside a heading, a bullet or a bold run tint like any other.
 *
 * ⚠ ONE PARSER, ONE SOURCE OF "AM I TAGGED" (reconciled in Phase 6; there used
 * to be a private copy of the token rule and the handle map).
 *   - WHERE a tint goes is `lib/mentions.ts`, the SAME module the server's
 *     resolution runs, so the transcript cannot tint a name the stamp did not
 *     resolve;
 *   - WHETHER the viewer is tagged is `row.mentionsMe`, read off the
 *     SERVER-STAMPED `metadata.mentionedUserIds` (`view-model-rows.ts ›
 *     toMessageRow`). That is the same fact the Tags inbox lists, so the
 *     transcript and the inbox cannot disagree about whether a message tagged
 *     you — which they could while the tint re-derived it from a roster that
 *     may have changed since the message was written.
 *
 * ⚠ PURE DISPLAY. Nothing here is the addressing rule: addressing is
 * `metadata.to_user_id`, stamped server-side and stripped from caller input
 * (INVARIANTS §5). A tinted name is not a claim that anybody was reached.
 */
function MentionText({ text, ctx }: { text: string; ctx: BodyContext }) {
  return (
    <>
      {text.split(MENTION_TOKEN_RE).map((part, i) => {
        if (!part.startsWith("@")) return <span key={i}>{part}</span>;
        const userId = resolveMentionToken(part, ctx.handles);
        // ⚠ AN AGENT MENTION TINTS THE SAME BLUE (Samuel, 2026-08-27) and is a SEPARATE
        // namespace — `@agent-<id>`, or the agent's slugged custom name. It is asked only when
        // the roster answered nobody, so a member can never lose their tint to an agent whose
        // operator named it after them; the roster is the wider claim and wins.
        // ⚠ NO VIEWER HIGHLIGHT ON THIS ARM. The bg wash means "this message tags YOU", which is
        // `metadata.mentionedUserIds` — a server fact about a MEMBER. An agent mention is not in
        // that set and must not borrow the signal.
        const agentId =
          userId === null
            ? resolveAgentHandle(mentionHandleOf(part), ctx.agentHandles)
            : null;
        if (!userId && !agentId) return <span key={i}>{part}</span>;
        // ⚠ AN AGENT TAG WEARS THE AGENT'S NAME, NOT ITS ID (Samuel, 2026-09-04). The id is the
        // ADDRESS — stored, on the wire, and what the desktop routes on — but nobody should have
        // to read `@agent-h1anog51` to know who was tagged. The face is resolved live off the
        // identity map, so a rename re-faces every existing mention with no stored body touched.
        // ⚠ THE RAW TOKEN IS THE `title`, so the address is one hover away and never lost.
        // ⚠ `null` FACE ⇒ THE TOKEN RENDERS EXACTLY AS IT ALWAYS DID — an agent that was never
        // named, and any agent that has ENDED (the identity map is the LIVE feed plus the peer
        // projection, and both drop a stopped session). Fallback, not failure.
        // ⚠ MEMBERS ARE UNTOUCHED: `face` is only ever computed on the agent arm.
        const face = agentId ? agentMentionFace(agentId, ctx.index.agents) : null;
        // ⚠ THE TRAILING RUN COMES BACK VERBATIM. `mentionHandleOf` strips punctuation and markup
        // off the END of the token (`@agent-h1anog51,` → `agent-h1anog51`), so swapping the whole
        // `part` for the face would silently eat the author's comma. The handle is a PREFIX of the
        // token by construction — both strips are end-anchored — so its length is where the face
        // stops and the prose resumes.
        const handle = face !== null ? mentionHandleOf(part) : null;
        const shown =
          face !== null && handle !== null
            ? `@${face}${part.slice(1 + handle.length)}`
            : part;
        return (
          <span
            key={i}
            // ⚠ ONLY WHERE A FACE REPLACED SOMETHING. A `title` equal to the visible text is
            // noise the browser still renders on hover.
            title={face !== null ? part : undefined}
            className={cn(
              "font-medium text-link",
              // ⚠ BOTH halves required: the stamp says this message tags me,
              // the token says THIS is where. The stamp alone cannot place a
              // highlight and the token alone is a re-derivation.
              userId !== null &&
                ctx.mentionsMe &&
                userId === ctx.index.currentUserId &&
                "rounded-[4px] bg-link/10 px-0.5"
            )}
          >
            {shown}
          </span>
        );
      })}
    </>
  );
}

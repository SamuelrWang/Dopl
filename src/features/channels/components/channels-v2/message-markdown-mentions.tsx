/**
 * THE MENTION LEAF, split out of `message-markdown.tsx` on 2026-09-05 for the 500-line cap —
 * the same seam `message-markdown-links.tsx` was cut on, and for the same reason: this is a
 * POLICY (who gets tinted, and what a tag is spelled as), not markdown plumbing.
 */
import {
  MENTION_TOKEN_RE,
  mentionHandleOf,
  resolveMentionToken,
} from "../../lib/mentions";
import { agentMentionFace, resolveAgentHandle } from "../../lib/agent-mentions";
import { cn } from "@/shared/lib/utils";
import type { BodyContext } from "./message-markdown-context";

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
export function MentionText({ text, ctx }: { text: string; ctx: BodyContext }) {
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

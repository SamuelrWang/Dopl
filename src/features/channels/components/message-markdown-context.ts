/**
 * THE ONE SHAPE EVERY LEAF AND BLOCK OF A MESSAGE BODY IS HANDED.
 *
 * ⚠ ITS OWN MODULE SO THE BODY CAN BE SPLIT (2026-09-05). `message-markdown.tsx` crossed the
 * 500-line cap (`eslint.config.mjs › max-lines`, ENGINEERING.md §2) when the mention face landed,
 * and the natural cut is the mention renderer. Both halves need this type, so it lives where
 * neither has to import the other — a value import in that direction would be a cycle.
 */
import type { buildMentionIndex } from "../lib/mentions";
import type { AgentMentionIndex } from "../lib/agent-mentions";
import type { AuthorIndex } from "./view-model";

/** What every leaf and block needs: the roster, whether this row tags me, and
 *  the caller's two class halves (rules 4 and 5). */
export interface BodyContext {
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
  /**
   * **THE NEWEST SEQ THIS PANE HAS**, the ceiling a message CITATION is checked
   * against (`lib/message-refs.ts › isCitableSeq`). ⚠ `null` is "cannot say" and
   * draws no pills at all — a pane with no page loaded knows no ceiling.
   */
  newestSeq?: number | null;
  /**
   * **JUMP THE TRANSCRIPT TO A CITED MESSAGE.** ⚠ ABSENT MAKES A CITATION PLAIN
   * TEXT, which is the same absent-not-disabled rule the attribution pill follows:
   * a host with no transcript to move (the pop-out, a digest) hands none, and a
   * pill that cannot navigate must not look like it can.
   */
  onJumpToSeq?: (seq: number) => void;
}

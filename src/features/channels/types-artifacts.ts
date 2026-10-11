// Split out of `types.ts` at the 500-line cap (2026-10-11), verbatim. `types.ts` re-exports all
// three names. The back-edge to `ChannelMessage` is type-only, the pattern `types-list.ts` uses.
import type { ChannelMessage } from "./types";

/**
 * AN ARTIFACT — a THREAD FORMED AFTER THE FACT (design #1220, accepted #1222).
 *
 * ⚠ **IT IS NOT AN EDIT AND NOT A DELETE.** Every message it folds keeps its body,
 * author, metadata and `seq`; folding is a view decision recorded on
 * `channel_messages.artifact_id` and reversible without loss — the property the rest
 * of the design rests on. ⚠ NO MEMBER LIST HERE: membership is the column, which
 * makes "one artifact per message, no nesting" a schema property, not a rule to
 * enforce.
 */
export type ChannelArtifact = {
  id: string;
  channelId: string;
  workspaceId: string;
  name: string;
  summary: string;
  createdBy: string;
  /** The agent INSTANCE id that made it, or `null` for a person acting directly. */
  createdByAgent: string | null;
  /** ⚠ RETIRED, NEVER DELETED — a dissolved artifact still resolves, so an old
   *  citation gets an honest answer instead of a 404. */
  dissolvedAt: string | null;
  createdAt: string;
};

/**
 * THE FOLDED CARD — one synthetic entry standing in for a run of messages on a
 * default read (design §4).
 *
 * ⚠ **THE SPAN IS LOAD-BEARING, NOT DECORATION.** A reader holding an old citation
 * can tell from `firstSeq` / `lastSeq` WHICH artifact holds it without opening
 * anything, and `count` beside it says whether the artifact is a solid run or a
 * selection out of one (#1220 §7, fork 3). ⚠ **COUNT AND SPAN ARE OVER THE WHOLE
 * ARTIFACT, NEVER OVER THE PAGE** — a per-page count answers a different question
 * every time the page moves.
 */
export type ChannelFoldedArtifact = {
  artifact: ChannelArtifact;
  /** Total members, channel-wide. */
  count: number;
  /** Lowest and highest member `seq`. ⚠ The card renders at `firstSeq`. */
  firstSeq: number;
  lastSeq: number;
};

/**
 * ONE ENTRY ON A DEFAULT READ: a message, or a card standing in for a folded run.
 *
 * ⚠ **THIS IS THE ONE GENUINELY BREAKING PART OF THE DESIGN AND IT IS STATED RATHER
 * THAN SOFTENED** (#1220 §4): a client that does not know about artifacts gets a card
 * where it expected messages — the saving IS the substitution. ⚠ THE DISCRIMINATOR IS
 * `type`, PRESENT ON BOTH ARMS; testing for the ABSENCE of a message field would
 * treat a future entry shape as a card.
 */
export type ChannelReadEntry =
  | { type: "message"; message: ChannelMessage }
  | { type: "artifact"; folded: ChannelFoldedArtifact };

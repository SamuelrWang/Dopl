/**
 * ARTIFACT types — the after-the-fact fold of a run of main-room messages
 * (#1220, accepted #1222).
 *
 * ⚠ **ITS OWN MODULE FOR `escalation-types.ts` / `launch-types.ts` / `info-card-types.ts`'s
 * REASON, WHICH IS THE ONLY REASON THIS PACKAGE SPLITS A TYPE FILE**: `channel-types.ts`
 * is at the 500-line cap (§1; the `size-check` CI job, and `max-lines` in
 * `eslint.config.mjs`). The seam is a REASON TO CHANGE, not a line count — artifacts are
 * one feature's shapes, they arrived together and they change together.
 *
 * ⚠ **RE-EXPORTED UNCHANGED FROM `channel-types.ts`, SO NO CONSUMER MOVED.** Every name
 * here is still `import type { … } from "@dopl/client"`, which is the same discipline the
 * three modules above already follow.
 */

import type { ChannelMessage } from "./channel-types.js";

/**
 * AN ARTIFACT — a thread formed AFTER THE FACT: a name+summary card standing in
 * for a set of existing main-room messages (#1220, accepted #1222).
 *
 * ⚠ **NOT AN EDIT AND NOT A DELETE.** Every message it folds keeps its body,
 * author, metadata and `seq`; folding is a view decision and it is reversible.
 * ⚠ **THE MIRROR IS HAND-MAINTAINED** — it must stay byte-identical to
 * `src/features/channels/types.ts › ChannelArtifact`.
 */
export interface ChannelArtifact {
  id: string;
  channelId: string;
  workspaceId: string;
  name: string;
  summary: string;
  createdBy: string;
  createdByAgent: string | null;
  /** ⚠ Retired, never deleted: a dissolved card still resolves. */
  dissolvedAt: string | null;
  createdAt: string;
}

/** The folded card as a read returns it. ⚠ `count` and the seq span are over
 *  the WHOLE artifact, never over the page that showed it. */
export interface ChannelFoldedArtifact {
  artifact: ChannelArtifact;
  count: number;
  firstSeq: number;
  lastSeq: number;
}

/**
 * ONE ROW OF A FOLDED READ: a message, or a card standing in for a run of them.
 *
 * ⚠ **THE DISCRIMINATOR IS `type`, PRESENT ON BOTH ARMS.** A reader that tested
 * for the ABSENCE of `message` would treat a future entry shape as a card.
 */
export type ChannelReadEntry =
  | { type: "message"; message: ChannelMessage }
  | { type: "artifact"; folded: ChannelFoldedArtifact };

/** What a write action actually did. ⚠ `folded` MAY BE SHORTER THAN
 *  `requested` — a seq that does not exist, or is already in another artifact,
 *  simply does not fold, and a bare count would hide that. */
export interface ChannelArtifactResult {
  artifact: ChannelArtifact;
  requested: number[];
  folded: number[];
  /**
   * The member list behind `folded` hit the server's ceiling (2026-09-06). Only
   * an IDEMPOTENT-CREATE convergence can set it: that path re-reads the card's
   * members, and a clipped list that renders like an exhausted one is the bug
   * `read`'s own `truncated` exists to prevent.
   *
   * ⚠ OPTIONAL because older servers omit it — treat `undefined` as "not
   * clipped", never "unknown", the same reading `OntologyMap.truncated` takes.
   */
  truncated?: boolean;
}

/** `create` / `add` / `remove` / `dissolve` — the wire shape is `{action, …}`. */
export type ChannelArtifactAction =
  | {
      action: "create";
      name: string;
      summary?: string;
      messages: number[];
      /** ⚠ The retry key. Without one, a retried create makes a SECOND card
       *  over messages the first already took, and half the run is in each. */
      clientMsgId?: string;
    }
  | { action: "add"; artifact: string; message: number }
  | { action: "remove"; artifact: string; message: number }
  | { action: "dissolve"; artifact: string };

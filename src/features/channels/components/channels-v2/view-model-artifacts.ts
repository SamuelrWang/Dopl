/**
 * Channels v2 — THE ARTIFACT HALF OF THE TRANSCRIPT'S ROWS: the `entries`
 * envelope turned into rows a pane can draw (artifacts #1220 §4, A4 closing
 * slice 2026-09-06).
 *
 * ⚠ **ITS OWN MODULE, ON THE `view-model-escalation.ts` PRECEDENT** (INVARIANTS
 * §1: one file per reason to change). This moves when the ARTIFACT product
 * moves; `view-model-rows.ts` moves when a MESSAGE row's shape does. It is also
 * the only way the derivation fits at all — that file is at 482 lines against a
 * hard 500 cap, and §1 is explicit that a file at the cap cannot absorb even a
 * comment.
 *
 * ⚠ **NOTHING HERE IMPORTS `view-model-rows.ts`, AND THAT IS THE CYCLE FIX
 * LANDING RATHER THAN LUCK.** That file type-imports {@link ArtifactRow} from
 * this one to widen `TranscriptRow`, so an import back would close the loop.
 * {@link withArtifactCards} is therefore GENERIC over the row it splices into —
 * it needs `kind` and `seq` and nothing else, which is exactly the part of a
 * transcript row this derivation is entitled to know about.
 *
 * ⚠ **THE ENVELOPE IS ADDITIVE AND THIS FILE HONORS THAT PRECISELY.** `entries`
 * is `null` on every page with nothing folded, and the caller then renders
 * `messages` exactly as it did before artifacts existed. The breaking flip is
 * Samuel's decision, not this module's default.
 */

import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../../types";
import { labelFor, type AuthorIndex } from "./view-model";

/**
 * ONE FOLDED MESSAGE, AS THE CARD SHOWS IT — its own `seq` visible, because a
 * citation is the whole reason the span is on the card (#1220 §4: the members
 * are shown "with their own seqs visible").
 */
export interface ArtifactMember {
  id: string;
  seq: number;
  authorLabel: string;
  time: string;
  body: string;
}

/**
 * A CARD ROW. ⚠ NO SIDE AND NO AUTHOR: an artifact is a view decision over
 * several people's messages, not somebody's words, so it wears the full-width
 * card treatment rather than a side (INVARIANTS §5 governs SIDES, and this row
 * has none to get wrong).
 */
export interface ArtifactRow {
  kind: "artifact";
  /** The artifact id — one card per artifact per page, so it is unique here. */
  id: string;
  /**
   * WHERE THE CARD SITS: **the lowest member seq ON THIS PAGE**, which is the
   * design's render position. ⚠ NOT {@link ArtifactRow.firstSeq} — that is the
   * artifact's channel-wide first member and may be far above this page, which
   * would park every card at the top of a back-page.
   */
  seq: number;
  name: string;
  summary: string;
  /** Total members, channel-wide. ⚠ Never the number on this page. */
  count: number;
  firstSeq: number;
  lastSeq: number;
  /** The members present on this page, in seq order. May be empty. */
  members: ArtifactMember[];
}

/**
 * THE MESSAGES A FOLDED PAGE STILL RENDERS AS MESSAGES — the `message` arms of
 * the envelope, in order.
 *
 * ⚠ **THE CALLER MUST BUILD ITS ORDINARY ROWS FROM THIS, NOT FROM THE FULL
 * PAGE.** `messages` stays complete on the wire on purpose (artifact-unaware
 * clients), so handing that array to `channelRows` would draw every folded
 * message a second time, underneath the card that folded it.
 */
export function unfoldedMessages(entries: ChannelReadEntry[]): ChannelMessage[] {
  const out: ChannelMessage[] = [];
  for (const entry of entries) {
    if (entry.type === "message") out.push(entry.message);
  }
  return out;
}

/**
 * The members of ONE artifact that are on this page, in seq order.
 *
 * ⚠ IT READS THE FULL `messages` PAGE, WHICH IS THE ONE THING THE ADDITIVE
 * ENVELOPE IS GOOD FOR HERE: the folded bodies are absent from `entries` by
 * construction, and they are exactly what the card expands to show. No fetch,
 * no second read — the page already carries them.
 */
function membersOf(
  messages: ChannelMessage[],
  artifactId: string,
  index: AuthorIndex,
  formatTime: (iso: string) => string
): ArtifactMember[] {
  return messages
    .filter((message) => message.artifactId === artifactId)
    .sort((a, b) => a.seq - b.seq)
    .map((message) => ({
      id: message.id,
      seq: message.seq,
      authorLabel: labelFor(message, index),
      time: formatTime(message.createdAt),
      body: message.body,
    }));
}

/**
 * ONE CARD ROW out of one folded entry.
 *
 * ⚠ **AN ARTIFACT WITH NO MEMBER ON THIS PAGE ANCHORS ON `firstSeq` AND STILL
 * RENDERS.** It should not happen — the server emits an entry only where a
 * member sat — but a card that vanished because its bodies were missing would
 * be the read path silently losing a row, which is the failure `foldEntries`
 * refuses on the server for the same reason.
 */
export function artifactRowFor(
  folded: ChannelFoldedArtifact,
  messages: ChannelMessage[],
  index: AuthorIndex,
  formatTime: (iso: string) => string
): ArtifactRow {
  const members = membersOf(messages, folded.artifact.id, index, formatTime);
  return {
    kind: "artifact",
    id: folded.artifact.id,
    seq: members.length > 0 ? members[0].seq : folded.firstSeq,
    name: folded.artifact.name,
    summary: folded.artifact.summary,
    count: folded.count,
    firstSeq: folded.firstSeq,
    lastSeq: folded.lastSeq,
    members,
  };
}

/**
 * SPLICE THE CARDS INTO A BUILT PAGE OF ROWS.
 *
 * ⚠ **THE ORDINARY ROWS ARE BUILT IN ONE PASS, BY THE ONE BUILDER, AND THIS
 * ONLY INSERTS.** The alternative — walking `entries` and calling `channelRows`
 * on each unfolded RUN between two cards — was rejected: `channelRows` carries
 * per-page state (the fan-out pre-pass and `openerSeen`), so a request whose
 * opening messages straddled a card would draw its thread card twice. One call,
 * then an insertion, cannot disagree with itself.
 *
 * ⚠ **THE POSITION IS THE SEQ, NOT THE ENTRY ORDER.** A message arm can produce
 * no row at all (a dropped `task_started`, a threaded reply collapsed into its
 * card), so an anchor that named a neighbouring row would sometimes name a row
 * that is not there. Every row in this tree carries `seq`, and the card goes
 * before the first row that is newer than it.
 *
 * ⚠ **A CARD BREAKS A RUN** (F-251's rule, the same one `ThreadCardRow` and the
 * escalation card follow): the row immediately after an inserted card cannot be
 * a continuation, because there is no attribution pill above it any more to
 * continue FROM. The row is cloned rather than mutated — these rows come from a
 * memo and are somebody else's values.
 */
export function withArtifactCards<R extends { kind: string; seq: number }>(
  rows: R[],
  entries: ChannelReadEntry[],
  messages: ChannelMessage[],
  index: AuthorIndex,
  formatTime: (iso: string) => string
): (R | ArtifactRow)[] {
  const cards = entries
    .filter((entry): entry is Extract<ChannelReadEntry, { type: "artifact" }> =>
      entry.type === "artifact"
    )
    .map((entry) => artifactRowFor(entry.folded, messages, index, formatTime))
    .sort((a, b) => a.seq - b.seq);
  if (cards.length === 0) return [...rows];

  const out: (R | ArtifactRow)[] = [];
  let next = 0;
  for (const row of rows) {
    let inserted = false;
    while (next < cards.length && cards[next].seq < row.seq) {
      out.push(cards[next]);
      next += 1;
      inserted = true;
    }
    out.push(inserted ? breakRun(row) : row);
  }
  for (; next < cards.length; next += 1) out.push(cards[next]);
  return out;
}

/** A row that follows a card, with its continuation flag cleared if it had one.
 *  ⚠ Structural rather than typed on `MessageRow`: this module cannot import the
 *  row union without closing the cycle its docblock names. */
function breakRun<R extends { kind: string; seq: number }>(row: R): R {
  return "continuation" in row && row.continuation === true
    ? { ...row, continuation: false }
    : row;
}

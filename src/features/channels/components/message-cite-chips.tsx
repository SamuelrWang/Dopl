/**
 * **THE CITATIONS A BODY NEVER MENTIONS, AS CHIPS** (grammar B, Samuel's card
 * #4401, 2026-10-12).
 *
 * ⚠ **THIS IS THE HOLE GRAMMAR B OPENS, AND IT HAS TO BE CLOSED SOMEWHERE.**
 * Under the old rule a reference existed only if the author typed the number, so
 * nothing could be cited invisibly. Now the FIELD is the reference: an agent can
 * cite three messages and write "as discussed above", and the reader would be
 * told nothing and could reach nothing. A structured citation that the reader
 * cannot see is worse than no citation at all, because the author believes it
 * landed.
 *
 * ⚠ **IT DRAWS ONLY WHAT THE BODY LEFT OUT** (`lib/cites.ts › citesNotInBody`).
 * A citation the author DID write inline is already a pill where their sentence
 * put it; repeating it here would double every reference in the common case and
 * train the reader to ignore the row.
 *
 * ⚠ **ABSENT HANDLER, NO CHIPS** — the same absent-not-disabled rule the pill
 * follows. A host with no transcript to move hands no `onJumpToSeq`, and a chip
 * that cannot navigate must not look like it can.
 */

import { citeLabel, citesNotInBody, type MessageCites } from "../lib/cites";
import { CITE_PILL } from "./message-markdown-refs";
import { cn } from "@/shared/lib/utils";

export function MessageCiteChips({
  cites,
  body,
  onJumpToSeq,
}: {
  cites: MessageCites;
  /** The row's stored text — what the chips are measured AGAINST, never rendered. */
  body: string;
  onJumpToSeq?: (seq: number) => void;
}) {
  // ⚠ `null` IS A LEGACY ROW, not an empty list: it has no resolved citations at
  // all and nothing to chip. Both land here, deliberately, on the same `return`.
  if (cites === null || cites.length === 0 || onJumpToSeq === undefined) {
    return null;
  }
  const orphans = citesNotInBody(cites, body);
  if (orphans.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-micro text-text-muted">
      {/* ⚠ A WORD, NOT AN ICON: the row is explaining that these numbers are
          references the sentence above did not name, which no glyph says. */}
      <span>Cites</span>
      {orphans.map((cite) => (
        <button
          key={cite.messageId}
          type="button"
          // ⚠ A STABLE HOOK so a test can tell a CHIP from an in-body PILL. They
          // share an accessible name on purpose — both say "go to message" to a
          // screen reader — which makes them indistinguishable by role and name.
          data-cite-chip=""
          onClick={() => onJumpToSeq(cite.seq)}
          // ⚠ LABELLED BY WHAT IT SHOWS, JUMPED BY `seq` — the same split the pill
          // makes. The face is the per-channel number once one exists; the host's
          // jump takes a seq because that is what page-back can hunt.
          aria-label={`Go to message ${citeLabel(cite)}`}
          className={cn(CITE_PILL, "cursor-pointer")}
        >
          {citeLabel(cite)}
        </button>
      ))}
    </p>
  );
}

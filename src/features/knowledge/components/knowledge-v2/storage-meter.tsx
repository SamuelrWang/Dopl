"use client";

import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatBytes } from "@/shared/lib/format-bytes";

interface Props {
  /** `knowledge_bases.storage_bytes` for this base. `null` = UNKNOWN. */
  usedBytes: number | null;
  /** The workspace's per-base cap. `null` = UNKNOWN. */
  limitBytes: number | null;
  className?: string;
}

/**
 * The per-knowledge-base storage bar, rendered in the two places a base's own
 * facts are shown: each card on the home grid and the base overview's Details
 * card. One component so the two can never disagree about when a base counts as
 * frozen or about how the refusal is worded.
 *
 * MISSING IS UNKNOWN, NEVER ZERO. Either half absent renders NOTHING — no
 * empty track, no "0 of 5 MB". The grid already follows that rule for the entry
 * count, and it is the only honest reading: `null` here means the counter or
 * the plan could not be read (the usual cause being a build that deployed ahead
 * of its migration), and an empty bar would assert a fact nobody measured.
 *
 * `over` IS THE ENTITLEMENT VERDICT, which `UsageMeter`'s header insists on and
 * which happens to be expressible in arithmetic here: the write gate refuses
 * when `used + delta > limit`, so at `used >= limit` EVERY positive delta is
 * already refused. That is the frozen state, exactly — not a cosmetic
 * threshold, and not `used > limit` (which would draw a full bar as if the next
 * write would still land).
 *
 * The `inline` (phrasing-content) pass-through is GONE as of 2026-08-12: the
 * knowledge home card stopped being a single `<button>` when it grew a star,
 * so both call sites now render the block form and there is one shape of this
 * meter again rather than two.
 */
export function StorageMeter({ usedBytes, limitBytes, className }: Props) {
  if (usedBytes === null || limitBytes === null || limitBytes <= 0) return null;
  const over = usedBytes >= limitBytes;
  return (
    <UsageMeter
      label="Storage"
      used={usedBytes}
      limit={limitBytes}
      over={over}
      overNote={
        // Says what froze and what did not — every gate in this product
        // freezes, it never deletes.
        "Full. Nothing was deleted — this base stays readable, and deleting " +
        "files or making one smaller still works. Upgrade for more room."
      }
      // THE ONLY RAMPED METER (2026-08-14). Both call sites sit where the
      // reader is scanning rather than reading — a grid of cards, and a
      // Details card beside a tree — so "how much room is left" has to survive
      // being glanced at, which a byte count in `text-caption` does not. The
      // entitlement meters (plan seats, MCP credits) keep the flat CTA fill:
      // there the number IS the message and a colour would compete with it.
      tone="ramp"
      formatValue={formatBytes}
      className={className}
    />
  );
}

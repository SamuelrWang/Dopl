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
 * Per-base storage bar. ONE component for both call sites (home card, base
 * overview Details card) so they can never disagree about when a base is frozen
 * or how the refusal is worded.
 *
 * ⚠ MISSING IS UNKNOWN, NEVER ZERO. Either half `null` renders NOTHING — no
 * empty track, no "0 of 5 MB". `null` means the counter or plan could not be
 * read (usually a build deployed ahead of its migration); an empty bar would
 * assert a fact nobody measured.
 *
 * ⚠ `over` is the ENTITLEMENT VERDICT, not a cosmetic threshold: the write gate
 * refuses when `used + delta > limit`, so at `used >= limit` every positive
 * delta is already refused. NOT `used > limit`, which draws a full bar as if
 * the next write would still land.
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
        // Gates in this product FREEZE, never delete — say so.
        "Full. Nothing was deleted — this base stays readable, and deleting " +
        "files or making one smaller still works. Upgrade for more room."
      }
      // THE ONLY RAMPED METER. Both call sites sit where the reader is
      // scanning rather than reading, so "how much room is left" has to
      // survive being glanced at, which a byte count in `text-caption` does
      // not. The entitlement meters (plan seats, MCP credits) keep the flat
      // CTA fill: there the number IS the message and a colour competes.
      tone="ramp"
      formatValue={formatBytes}
      className={className}
    />
  );
}

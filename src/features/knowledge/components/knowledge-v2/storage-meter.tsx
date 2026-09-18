"use client";

import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatBytes } from "@/shared/lib/format-bytes";

interface Props {
  /** `knowledge_bases.storage_bytes` for this base. `null` = unknown. */
  usedBytes: number | null;
  /** The workspace's per-base cap. `null` = unknown. */
  limitBytes: number | null;
  className?: string;
}

/**
 * Per-base storage bar. One component for both call sites (home card, base
 * overview Details card) so they cannot disagree about when a base is frozen.
 *
 * Missing is unknown, never zero: either half `null` renders nothing — an empty
 * track would assert a fact nobody measured.
 *
 * `over` is the entitlement verdict, not a cosmetic threshold: the write gate
 * refuses when `used + delta > limit`, so at `used >= limit` every positive
 * delta is already refused. Not `used > limit`, which would draw a full bar as
 * if the next write would still land.
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
        // gates in this product freeze, never delete — say so.
        "Full. Nothing was deleted — this base stays readable, and deleting " +
        "files or making one smaller still works. Upgrade for more room."
      }
      // the only ramped meter: both call sites are scanned, not read, so the
      // remaining room must survive a glance. The entitlement meters (plan
      // seats, MCP credits) keep the flat CTA fill — there the number is the
      // message and a colour competes.
      tone="ramp"
      formatValue={formatBytes}
      className={className}
    />
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RESET_MS = 1500;

export interface UseCopyToClipboardResult {
  /** True while any target is in its post-copy flash. */
  copied: boolean;
  /** The id passed to `copy` — for surfaces with several copy targets. */
  copiedId: string | null;
  /** Writes to the clipboard; resolves false when it's unavailable. */
  copy: (text: string, id?: string) => Promise<boolean>;
}

/**
 * Copy-to-clipboard with the transient "copied" flash — the single
 * implementation behind every Copy→Check affordance. Guards missing
 * `navigator.clipboard` (SSR, insecure contexts) and resets after
 * `resetMs`.
 */
export function useCopyToClipboard(
  resetMs: number = RESET_MS
): UseCopyToClipboardResult {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string, id: string = "copied") => {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return false;
      }
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
      setCopiedId(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedId(null), resetMs);
      return true;
    },
    [resetMs]
  );

  return { copied: copiedId !== null, copiedId, copy };
}

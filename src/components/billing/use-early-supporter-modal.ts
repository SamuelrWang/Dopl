"use client";

import { useEffect, useState } from "react";
import { EARLY_SUPPORTER_ENABLED } from "@/lib/billing/early-supporter-flag";

const SEEN_KEY = "dopl:early-supporter-seen";

/**
 * Returns whether to show the early-supporter congrats modal.
 *
 * Open iff:
 *   1. The promo is enabled (early-supporter-flag.ts)
 *   2. /api/user/credits says we received the grant (earlySupporterGrantedAt set)
 *   3. localStorage doesn't yet record that the user has dismissed it
 *
 * `markSeen()` flips the localStorage flag and closes the modal — never
 * reopens for this browser.
 */
export function useEarlySupporterModal(): {
  open: boolean;
  markSeen: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!EARLY_SUPPORTER_ENABLED) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(SEEN_KEY)) return;

    fetch("/api/user/credits")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.earlySupporterGrantedAt) {
          setOpen(true);
        }
      })
      .catch(() => {
        // Silent — not worth surfacing to the user.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      // Private mode / quota exceeded — accept that the modal may reappear.
    }
    setOpen(false);
  }

  return { open, markSeen };
}

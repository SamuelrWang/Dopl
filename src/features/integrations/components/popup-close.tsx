"use client";

import { useEffect } from "react";
import type { IntegrationProvider } from "../types";

/**
 * Tiny client component that runs inside the OAuth popup window. On
 * mount it fires a `dopl:integration:result` postMessage to the
 * opener and tries to close itself. The opener (the
 * /settings/integrations page) listens for the message to refresh
 * its connections list.
 *
 * `window.close()` only works for windows opened by `window.open`,
 * which is exactly our case. Browsers without that permission keep
 * the page open; the user sees "You can close this window" and
 * dismisses it manually — graceful fallback.
 */
type Props = {
  status: "ok" | "error";
  provider: IntegrationProvider | null;
  reason?: string | null;
};

export function PopupClose({ status, provider, reason }: Props) {
  useEffect(() => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            type: "dopl:integration:result",
            status,
            provider,
            reason: reason ?? null,
          },
          window.location.origin
        );
      }
    } catch {
      // Cross-origin or blocked — the opener may be on a different
      // origin during local dev; the user can close manually.
    }
    const t = setTimeout(() => {
      try {
        window.close();
      } catch {
        // No-op: see comment above.
      }
    }, 250);
    return () => clearTimeout(t);
  }, [provider, reason, status]);

  return null;
}

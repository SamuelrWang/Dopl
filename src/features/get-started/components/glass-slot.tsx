"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Portal children into the element with `id` — the auth layout's glass slot
 * (`AUTH_GLASS_SLOT_ID`) — and KEEP them there.
 *
 * ⚠ NEVER A ONE-SHOT LOOKUP. This used to read `getElementById` once, a frame
 * after mount, and the installer sometimes never appeared (measured 2026-10-14,
 * 1440px fresh load: slot present, 0 children). The page and the layout that
 * owns the slot are separate trees under App Router; the one-shot read could
 * run before the slot existed, or land in a server-rendered slot node that
 * hydration then replaced or emptied — and nothing ever looked again.
 *
 * ⚠ SO THE PORTAL TARGETS A HOST NODE THIS COMPONENT OWNS, not the slot. The
 * host (`display: contents`, so layout and inherited vars pass straight
 * through) is appended into the slot, and a document `MutationObserver`
 * (coalesced to one rAF) re-appends it whenever the slot first appears, is
 * REPLACED by a different element under the same id, or was emptied behind
 * React's back. React's portal tree lives inside the host and is never torn
 * down by any of that — no remount, and no `removeChild` on a node someone
 * else already removed. Re-appending a host that is already in place is
 * skipped, so the observer goes quiet: it cannot spin.
 */
export function GlassSlot({ id, children }: { id: string; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const node = document.createElement("div");
    node.style.display = "contents";
    let frame = 0;
    let published = false;
    const attach = () => {
      frame = 0;
      const slot = document.getElementById(id);
      if (!slot) return;
      if (node.parentNode !== slot) slot.appendChild(node);
      if (!published) {
        published = true;
        setHost(node);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(attach);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
      node.remove();
    };
  }, [id]);

  return host ? createPortal(children, host) : null;
}

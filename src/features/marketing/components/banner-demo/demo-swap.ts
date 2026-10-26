"use client";

/**
 * **THE DEMO'S FACE SWAP** — how the banner shows a redesigned card without touching the
 * shared product component (Samuel, 2026-10-22: the Agents-tab card).
 *
 * The product still renders every card. For each one {@link useDemoSwap} finds, it marks
 * the product element `data-lp-swapped` (hidden by `marketing.css`, inside the scene only),
 * parks a host element right after it, and hands the host back for a portal. So the row,
 * its reveal motion, the pane's stick-to-bottom scroll and every handler stay the product's.
 *
 * ⚠ **A MUTATION OBSERVER, NOT A RENDER-TIME LOOKUP.** Product rows mount, unmount and
 * re-order as the views swap, so the scan re-runs on every DOM change. It runs as a
 * microtask, before paint, and `flushSync` commits the portals in the same frame, so no
 * frame shows a row with its card missing.
 * ⚠ **A HOST FOLLOWS ITS SOURCE.** A keyed re-order moves the product node and leaves the
 * host behind, so each scan re-seats the host after its source, and a host whose source
 * is gone is removed.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

export const SWAPPED_ATTR = "data-lp-swapped";

export type SwapSource = { key: string; source: HTMLElement };
export type Swap = SwapSource & {
  host: HTMLElement;
  /** The source's text, so a product re-render that changes it re-renders the face. */
  sig: string;
};

const same = (a: readonly Swap[], b: readonly Swap[]) =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      s.key === b[i].key &&
      s.host === b[i].host &&
      s.source === b[i].source &&
      s.sig === b[i].sig
  );

export function useDemoSwap(
  rootRef: RefObject<HTMLElement | null> | undefined,
  /** Every product element to replace, keyed. Read through a ref, so it may be inline. */
  find: (root: HTMLElement) => SwapSource[],
  hostClass: string
): readonly Swap[] {
  const [swaps, setSwaps] = useState<readonly Swap[]>([]);
  const findRef = useRef(find);
  useEffect(() => {
    findRef.current = find;
  });

  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return;
    const hosts = new Map<string, HTMLElement>();
    const scan = () => {
      const next: Swap[] = [];
      const seen = new Set<string>();
      for (const { key, source } of findRef.current(root)) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (!source.hasAttribute(SWAPPED_ATTR)) source.setAttribute(SWAPPED_ATTR, "");
        let host = hosts.get(key);
        if (!host) {
          host = document.createElement("div");
          host.className = hostClass;
          hosts.set(key, host);
        }
        if (source.nextElementSibling !== host) source.after(host);
        next.push({ key, source, host, sig: source.textContent ?? "" });
      }
      for (const [key, host] of hosts) {
        if (seen.has(key)) continue;
        host.remove();
        hosts.delete(key);
      }
      flushSync(() => setSwaps((prev) => (same(prev, next) ? prev : next)));
    };
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    queueMicrotask(scan);
    return () => {
      observer.disconnect();
      for (const host of hosts.values()) host.remove();
    };
  }, [rootRef, hostClass]);

  return swaps;
}

/** `agent-07` or `var(--agent-color-07)` → 7, the colour-bank slot `PairedAvatar` rings in. */
export function colorSlot(value: string | null | undefined): number {
  const match = /(\d{1,2})\D*$/.exec(value ?? "");
  const n = match ? Number(match[1]) : NaN;
  return n >= 1 && n <= 16 ? n : 1;
}

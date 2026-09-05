"use client";

/**
 * WHICH FACE OF THE CHANNEL THE **WEB** SURFACE IS SHOWING — Channel, Info,
 * Threads, Agents or Settings — and where that answer is kept.
 *
 * ⚠ IT IS THE WEB'S STATE, NOT THE SURFACE'S (Samuel, 2026-09-04). The desktop
 * app shows the tab column BESIDE the transcript; on a phone there is no room
 * for two columns, so the same five faces become one dropdown over one full-width
 * main area. That is a HOST decision — `channel-surface.tsx` stays layout-agnostic
 * and router-free — so the state lives here and is handed down as a prop by the
 * one host that wants it (`src/app/c/[workspaceId]/guest-channel.tsx`).
 *
 * ⚠ THE URL IS THE STORE, and the hash is the URL part a client-only surface may
 * write without a router: reload and back/forward both keep the face, which a
 * `useState` cannot do. `#view=agents`. No hash at all is CHANNEL, so the plain
 * link a guest is sent still lands on the conversation.
 *
 * ⚠ `useSyncExternalStore`, NOT an effect. Reading `location` during render is a
 * hydration hazard and setting state from an effect is an ERROR in this tree
 * (`react-hooks/set-state-in-effect`); this is the sanctioned shape for an
 * outside-React value, and it gives the server snapshot for free.
 *
 * ⚠ THE OPEN AGENT IS NOT IN HERE. An agent is a live session on somebody's own
 * machine — it does not survive a reload, so a URL that named one would restore a
 * face with nothing behind it. The agent VIEW is `use-channels-v2-selection.ts ›
 * openAgent`, as it is on every other host; this hook carries only the five faces
 * the dropdown lists.
 */

import { useCallback, useSyncExternalStore } from "react";

/** The dropdown's faces, in the order it lists them. */
export const CHANNEL_WEB_VIEWS = [
  "channel",
  "info",
  "threads",
  "agents",
  "settings",
] as const;

export type ChannelWebViewKey = (typeof CHANNEL_WEB_VIEWS)[number];

export interface ChannelWebView {
  view: ChannelWebViewKey;
  setView: (next: ChannelWebViewKey) => void;
}

/** Pure, and exported for the test: `"#view=threads"` → `"threads"`.
 *  ⚠ ANYTHING UNRECOGNISED IS `channel` — a stale or hand-edited link lands on
 *  the conversation rather than on a blank face. */
export function parseChannelWebView(hash: string): ChannelWebViewKey {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("view");
  return (CHANNEL_WEB_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as ChannelWebViewKey)
    : "channel";
}

function subscribe(onChange: () => void) {
  // ⚠ BOTH EVENTS. `hashchange` covers our own writes and the address bar;
  // `popstate` covers a back/forward that lands on an entry whose hash matches
  // the current one in the same document.
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const readHash = () => window.location.hash;
/** No hash on the server — the first paint is the conversation, every time. */
const serverHash = () => "";

export function useChannelWebView(): ChannelWebView {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  // ⚠ ASSIGNMENT, not `replaceState`: it pushes a history entry, which is what
  // makes the phone's back gesture step between faces instead of leaving the
  // channel.
  const setView = useCallback((next: ChannelWebViewKey) => {
    window.location.hash = `view=${next}`;
  }, []);
  return { view: parseChannelWebView(hash), setView };
}

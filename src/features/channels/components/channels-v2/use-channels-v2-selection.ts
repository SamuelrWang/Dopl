"use client";

/**
 * WHAT THE CHANNELS PAGE HAS OPEN — the selection and nav state of
 * `channels-v2-core.tsx`, split out at the 500-line cap (§1) on the seam that
 * file's siblings already use: `use-inline-consent.ts` took the consent
 * decisions, `use-agents-panel.ts` the peer poll and the launch, `derivations.ts`
 * the row math. This takes the pieces of "which surface am I looking at", and
 * nothing else.
 *
 * ⚠ `inboxOpen` / `openInbox` STOOD HERE AND ARE DELETED (Samuel, 2026-08-25).
 * The consent Inbox was a CENTER-COLUMN TAKEOVER, which is why it needed
 * selection state at all; `inbox-pane.tsx`, the sidebar row that opened it and
 * the nav badge that counted it are all gone, and the outbound review lives in
 * the work stream's card (`agent-stream.tsx`). **Nothing here has a third state
 * any more** — the center column is a channel or the first-run explainer.
 *
 * ⚠ IT IS STATE PLUS ONE RENDER-TIME ADJUSTMENT, and the adjustment is why this
 * is a hook rather than a reducer file: `initialChannelId` is re-applied DURING
 * RENDER (React's own "adjusting state when a prop changes" shape), which only
 * works inside the render pass of the component that owns the state. A custom
 * hook runs in that pass; an effect does not, and
 * `react-hooks/set-state-in-effect` is an ERROR in this tree.
 *
 * ⚠ THE COMPOSITE ACTIONS ARE STILL THE POINT, not a convenience. `selectChannel`
 * and `openThread` each move more than one piece at once, and the page had four
 * hand-written copies of those combinations. ⚠ Each was ALSO clearing the Inbox
 * takeover until 2026-08-25 — that clause is deleted with the takeover, not
 * forgotten, and re-adding a surface these actions have to close means re-adding
 * the state they close it with.
 */

import { useCallback, useState } from "react";
import type { ScrollTarget } from "./message-pane";

export interface ChannelsV2Selection {
  /** The operator's explicit channel pick; `null` means "take the first row". */
  selectedId: string | null;
  /** The open thread, or `null` for the channel view. */
  requestedThreadId: string | null;
  /** `agentsModel › agentKey` of the open agent view, or `null`. */
  openAgent: string | null;
  infoOpen: boolean;
  scrollTarget: ScrollTarget | null;
  /**
   * NONCED REQUEST to open the composer's new-thread panel, for surfaces that
   * are not the composer (the Threads tab's button). Same shape and the same
   * reason as `scrollTarget`: asking twice must ask twice, and a boolean here
   * would be a SECOND source of truth for a panel the composer owns — the
   * composer would have to mirror it, and the two would drift.
   */
  newThreadSignal: number;
  createOpen: boolean;
  directOpen: boolean;
  setOpenAgent: (key: string | null) => void;
  setInfoOpen: (open: boolean) => void;
  setCreateOpen: (open: boolean) => void;
  setDirectOpen: (open: boolean) => void;
  /** Land on a channel: clears the thread. */
  selectChannel: (id: string | null) => void;
  /** Open a thread in the current channel. */
  openThread: (id: string | null) => void;
  toggleInfo: () => void;
  /** Ask the composer to open its new-thread panel. */
  requestNewThread: () => void;
  /** The Tags inbox's jump: a thread AND a nonced scroll signal. */
  jumpToMessage: (threadId: string | null, messageId: string) => void;
}

export function useChannelsV2Selection({
  initialChannelId = null,
  initialThreadId = null,
}: {
  initialChannelId?: string | null;
  initialThreadId?: string | null;
}): ChannelsV2Selection {
  const [selectedId, setSelectedId] = useState<string | null>(initialChannelId);
  const [createOpen, setCreateOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(
    initialThreadId
  );
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(true);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [newThreadSignal, setNewThreadSignal] = useState(0);

  // A SECOND notification, with the page already mounted, changes the route but
  // not the component — the initial `useState` above would never see it. So the
  // named channel is re-applied whenever it CHANGES, and only then: a value the
  // caller keeps handing us unchanged must not fight the operator's own clicks.
  // Going back to the paramless row (`initialChannelId` → null) names nothing
  // and therefore selects nothing; the current pick stands.
  //
  // ⚠ ADJUSTED DURING RENDER, NOT IN AN EFFECT — React's own "adjusting state
  // when a prop changes" shape, and `react-hooks/set-state-in-effect` is an
  // ERROR here (measured 2026-08-18), not a preference. The effect version
  // paints the OLD channel first and the named one on a second pass, which on
  // this surface is a visible flash of the wrong transcript. React re-runs the
  // calling component before committing anything, so the extra pass costs no DOM.
  const [routedId, setRoutedId] = useState<string | null>(initialChannelId);
  if (initialChannelId !== routedId) {
    setRoutedId(initialChannelId);
    if (initialChannelId) {
      setSelectedId(initialChannelId);
      // ⚠ The NAMED thread, not `null` (Phase 10). A notification names no thread,
      // so this stays the clear it always was; a pop-out landing names one, and
      // re-routing to a different channel must not silently drop it.
      setRequestedThreadId(initialThreadId);
    }
  }

  const selectChannel = useCallback((id: string | null) => {
    setSelectedId(id);
    setRequestedThreadId(null);
  }, []);

  const openThread = useCallback(
    (id: string | null) => setRequestedThreadId(id),
    []
  );
  const requestNewThread = useCallback(
    () => setNewThreadSignal((n) => n + 1),
    []
  );
  const toggleInfo = useCallback(() => setInfoOpen((open) => !open), []);

  // ⚠ THE SCROLL SIGNAL IS NONCED, so clicking the same mention twice
  // re-scrolls — a plain `{messageId}` object would be swallowed the moment
  // somebody "optimizes" the state update with an equality check
  // (`message-pane.tsx › ScrollTarget`).
  const jumpToMessage = useCallback(
    (threadId: string | null, messageId: string) => {
      setRequestedThreadId(threadId);
      setScrollTarget((prev) => ({ messageId, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    []
  );

  return {
    selectedId,
    requestedThreadId,
    openAgent,
    infoOpen,
    scrollTarget,
    newThreadSignal,
    createOpen,
    directOpen,
    setOpenAgent,
    setInfoOpen,
    setCreateOpen,
    setDirectOpen,
    selectChannel,
    openThread,
    toggleInfo,
    requestNewThread,
    jumpToMessage,
  };
}

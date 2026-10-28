"use client";

/**
 * WHAT THE CHANNELS PAGE HAS OPEN — the selection and nav state of
 * `channels-core.tsx`, split out at the 500-line cap (§1) on the seam that
 * file's siblings already use: `use-inline-consent.ts` took the consent
 * decisions, `use-agents-panel.ts` the peer poll and the launch, `derivations.ts`
 * the row math. This takes the pieces of "which surface am I looking at", and
 * nothing else.
 *
 * The center column is a channel or the first-run explainer, nothing else (the
 * consent Inbox takeover is deleted: docs/INVARIANTS.md "WHAT IS DELETED").
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
 * hand-written copies of those combinations. Re-adding a surface these actions
 * have to close means re-adding the state they close it with.
 */

import { useCallback, useState } from "react";
import type { ScrollTarget } from "./message-pane";

export interface ChannelsSelection {
  /** The operator's explicit channel pick; `null` means "take the first row". */
  selectedId: string | null;
  /** The open thread, or `null` for the channel view. */
  requestedThreadId: string | null;
  /** `agentsModel › agentKey` of the open agent view, or `null`. */
  openAgent: string | null;
  /**
   * NONCED ASK for the info column to land back on its DEFAULT face (Info).
   *
   * ⚠ **SAME SHAPE AND SAME REASON AS {@link newThreadSignal}**: the active tab is
   * `info-panel.tsx`'s own `useState` and must stay there — a boolean here would be a
   * SECOND source of truth for a choice that component owns, and the two would drift.
   * A nonce only ever says "somebody asked, again".
   */
  infoTabSignal: number;
  /** The task whose detail the Tasks tab shows, or `null` for its list. */
  openTaskId: string | null;
  /** ASKS for the info column to land on its Tasks tab, counted since the column last closed: the
   *  panel mounts with the column, so a nonce it seeded itself would miss the ask that opened it. */
  tasksTabSignal: number;
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
  /**
   * 🔒 **THE SENDER PILL IS A TOGGLE (Samuel, 2026-09-16)**: *"if a user clicks on the
   * badge and opens the agent view, i want to make it so that if they click the badge
   * again/aka click the badge of an agent already opened up in view, it goes back to the
   * channel info view, basically resets."*
   *
   * ⚠ **THE SAME KEY CLOSES, A DIFFERENT KEY SWITCHES.** Clicking another agent's pill
   * while one is open is unchanged — it opens that one, which is what the multiplayer
   * case needs.
   * ⚠ **AND CLOSING RESETS THE COLUMN, NOT ONLY THE OVERLAY** — *"basically resets"*. The
   * agent view is drawn OVER the info column, so a bare `setOpenAgent(null)` would reveal
   * whatever tab happened to be underneath; this bumps {@link infoTabSignal} with it.
   * ⚠ **IT IS THE PILL'S VERB AND NOT THE AGENTS TAB's.** A card there already renders
   * "Viewing" for the open agent and says what it does; `setOpenAgent` stays its handler,
   * so a press on a card that is already open is still a no-op rather than a surprise
   * close.
   */
  toggleAgent: (key: string) => void;
  setInfoOpen: (open: boolean) => void;
  setCreateOpen: (open: boolean) => void;
  setDirectOpen: (open: boolean) => void;
  /** Land on a channel: clears the thread. */
  selectChannel: (id: string | null) => void;
  /** List or detail inside the Tasks tab. */
  setOpenTaskId: (id: string | null) => void;
  /** From outside the column (the quick view): open it on Tasks, on that task or the list, over
   *  any open agent view. */
  openTask: (id: string | null) => void;
  /** Open a thread in the current channel. */
  openThread: (id: string | null) => void;
  toggleInfo: () => void;
  /** Ask the composer to open its new-thread panel. */
  requestNewThread: () => void;
  /** The Tags inbox's jump: a thread AND a nonced scroll signal. */
  jumpToMessage: (threadId: string | null, messageId: string) => void;
}

export function useChannelsSelection({
  initialChannelId = null,
  initialThreadId = null,
  initialTaskId = null,
}: {
  initialChannelId?: string | null;
  initialThreadId?: string | null;
  /** A task to open on mount, on the Tasks tab: `openTask`'s state, seeded. */
  initialTaskId?: string | null;
}): ChannelsSelection {
  const [selectedId, setSelectedId] = useState<string | null>(initialChannelId);
  const [createOpen, setCreateOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(
    initialThreadId
  );
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [infoOpen, setInfoOpenState] = useState(true);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [newThreadSignal, setNewThreadSignal] = useState(0);
  const [infoTabSignal, setInfoTabSignal] = useState(0);
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId);
  const [tasksTabSignal, setTasksTabSignal] = useState(initialTaskId ? 1 : 0);

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
      setOpenTaskId(null);
    }
  }

  const selectChannel = useCallback((id: string | null) => {
    setSelectedId(id);
    setRequestedThreadId(null);
    setOpenTaskId(null);
  }, []);

  const openTask = useCallback((id: string | null) => {
    setOpenTaskId(id);
    setOpenAgent(null);
    setInfoOpenState(true);
    setTasksTabSignal((n) => n + 1);
  }, []);

  const openThread = useCallback(
    (id: string | null) => setRequestedThreadId(id),
    []
  );
  const requestNewThread = useCallback(
    () => setNewThreadSignal((n) => n + 1),
    []
  );
  const setInfoOpen = useCallback((open: boolean) => {
    setInfoOpenState(open);
    if (!open) setTasksTabSignal(0);
  }, []);
  const toggleInfo = useCallback(() => setInfoOpen(!infoOpen), [infoOpen, setInfoOpen]);

  // ⚠ READ OUTSIDE THE UPDATER, deliberately. The obvious spelling is a functional
  // `setOpenAgent(open => …)` that bumps the nonce from inside — but a state updater
  // must be pure and React re-invokes it under StrictMode, so the bump would fire
  // twice. `openAgent` is already in this scope; comparing it here is one render
  // behind nothing.
  const toggleAgent = useCallback(
    (key: string) => {
      if (openAgent !== key) {
        setOpenAgent(key);
        return;
      }
      setOpenAgent(null);
      setInfoTabSignal((n) => n + 1);
    },
    [openAgent]
  );

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
    infoTabSignal,
    openTaskId,
    tasksTabSignal,
    createOpen,
    directOpen,
    setOpenAgent,
    toggleAgent,
    setInfoOpen,
    setCreateOpen,
    setDirectOpen,
    selectChannel,
    setOpenTaskId,
    openTask,
    openThread,
    toggleInfo,
    requestNewThread,
    jumpToMessage,
  };
}

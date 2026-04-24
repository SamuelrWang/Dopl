"use client";

/**
 * Two separate contexts on purpose:
 *
 *  - EntryPreviewActionsContext holds a stable `{ openPreview, closePreview }`
 *    object (memoized with no deps) that never changes across renders.
 *    EntryCards subscribe to this one only. Opening the panel does NOT
 *    trigger them to re-render.
 *
 *  - EntryPreviewIdContext holds the currently-previewed id. Only the
 *    panel subscribes to it.
 *
 * Merging them into a single context was tempting but caused every
 * EntryCard on the page to re-render whenever the preview opened/closed
 * — with 50+ cards visible after a few infinite-scroll batches, that
 * synchronous re-render blocked the main thread long enough for the
 * slide-in animation to visibly stutter.
 */

import { createContext, useContext, useMemo, useState } from "react";

interface EntryPreviewActions {
  openPreview: (id: string) => void;
  closePreview: () => void;
}

const EntryPreviewActionsContext = createContext<EntryPreviewActions | null>(null);
const EntryPreviewIdContext = createContext<string | null>(null);

export function EntryPreviewProvider({ children }: { children: React.ReactNode }) {
  const [previewId, setPreviewId] = useState<string | null>(null);

  const actions = useMemo<EntryPreviewActions>(
    () => ({
      openPreview: (id) => setPreviewId(id),
      closePreview: () => setPreviewId(null),
    }),
    [],
  );

  return (
    <EntryPreviewActionsContext.Provider value={actions}>
      <EntryPreviewIdContext.Provider value={previewId}>
        {children}
      </EntryPreviewIdContext.Provider>
    </EntryPreviewActionsContext.Provider>
  );
}

// Used by EntryCard. Stable reference — cards do NOT re-render when
// the preview opens or closes.
export function useEntryPreviewActions(): EntryPreviewActions | null {
  return useContext(EntryPreviewActionsContext);
}

// Used by EntryPreviewPanel only.
export function useEntryPreviewId(): string | null {
  return useContext(EntryPreviewIdContext);
}

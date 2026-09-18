"use client";

import { useCallback, useRef, useState } from "react";
import type { ColumnDraftPatch } from "../optimistic-create";
import type { OntologyObject } from "../types";

/**
 * "+ Object" as a two-step act (Samuel, 2026-09-11): the lane appears on the click
 * and the popup decides whether it stays. Its own file for the 500-line cap
 * (`eslint.config.mjs › max-lines`); not a second store — every write it makes is
 * the ontology store's own (`use-ontology-creates.ts`).
 *
 * The draft is a row, not an id: `commitColumnDraft` builds the POST body from the
 * row, and a provisional id cannot be looked back up once `CREATE_RESOLVE` has
 * swapped it.
 */
export interface ObjectDraft {
  /** True while a draft lane is on the board waiting for the popup's answer. */
  open: boolean;
  begin: (clusterId: string) => void;
  /** Discard / Escape / backdrop — the lane leaves, nothing was ever sent. */
  discard: () => void;
  create: (patch: ColumnDraftPatch) => void;
}

export function useObjectDraft({
  beginColumnDraft,
  discardColumnDraft,
  commitColumnDraft,
}: {
  beginColumnDraft: (clusterId: string) => OntologyObject;
  discardColumnDraft: (draftId: string) => void;
  commitColumnDraft: (
    clusterId: string,
    draft: OntologyObject,
    patch: ColumnDraftPatch
  ) => void;
}): ObjectDraft {
  // A ref beside the flag, not state alone: each act dispatches, and a dispatch
  // inside a `setState` updater runs during render — twice under StrictMode, which
  // is two lanes for one click. The ref holds the row; the render reads only the
  // boolean.
  const draftRef = useRef<{ clusterId: string; row: OntologyObject } | null>(null);
  const [open, setOpen] = useState(false);

  const begin = useCallback(
    (clusterId: string) => {
      // One draft at a time: a second click would strand the first lane on the
      // board with nothing holding its row.
      if (draftRef.current) return;
      draftRef.current = { clusterId, row: beginColumnDraft(clusterId) };
      setOpen(true);
    },
    [beginColumnDraft]
  );

  const take = useCallback(() => {
    const current = draftRef.current;
    draftRef.current = null;
    setOpen(false);
    return current;
  }, []);

  const discard = useCallback(() => {
    const current = take();
    if (current) discardColumnDraft(current.row.id);
  }, [take, discardColumnDraft]);

  const create = useCallback(
    (patch: ColumnDraftPatch) => {
      const current = take();
      if (current) commitColumnDraft(current.clusterId, current.row, patch);
    },
    [take, commitColumnDraft]
  );

  return { open, begin, discard, create };
}

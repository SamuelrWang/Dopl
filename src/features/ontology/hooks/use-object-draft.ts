"use client";

import { useCallback, useRef, useState } from "react";
import type { ColumnDraftPatch } from "../optimistic-create";
import type { OntologyObject } from "../types";

/**
 * "+ Object" AS A TWO-STEP ACT (2026-09-11, Samuel's popup ruling) — the lane
 * appears on the click and the popup decides whether it stays.
 *
 * ⚠ **ITS OWN FILE FOR THE 500-LINE CAP** (`eslint.config.mjs › max-lines`):
 * `ontology-view.tsx` sits at the cap, and this is the one piece of the flow that
 * is state rather than markup. It is not a second store — every write it makes is
 * the ontology store's own (`use-ontology-creates.ts`).
 *
 * ⚠ **THE DRAFT IS A ROW, NOT AN ID.** `commitColumnDraft` needs the row as it
 * was dispatched (the POST body is built from it), and a provisional id cannot be
 * looked back up once `CREATE_RESOLVE` has swapped it.
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
  // ⚠ A REF BESIDE THE FLAG, NOT STATE ALONE: each of the three acts DISPATCHES,
  // and a dispatch inside a `setState` updater runs during render — twice under
  // StrictMode, which is two lanes for one click. The ref holds the row; the
  // boolean is the only thing the render reads.
  const draftRef = useRef<{ clusterId: string; row: OntologyObject } | null>(null);
  const [open, setOpen] = useState(false);

  const begin = useCallback(
    (clusterId: string) => {
      // One draft at a time: a second click while the popup is open would strand
      // the first lane on the board with nothing left holding its row.
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

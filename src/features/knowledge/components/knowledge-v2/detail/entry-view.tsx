"use client";

import { DocPane } from "../../doc-pane";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import styles from "../knowledge-v2.module.css";

interface Props {
  base: KnowledgeBase;
  /** Tree-metadata entry (title/timestamps; body stripped). */
  metaEntry: KnowledgeEntry;
  /** Full entry with body, once the controller's per-entry fetch resolves. */
  fullEntry: KnowledgeEntry | null;
  status: "idle" | "loading" | "success" | "error";
  workspaceId: string;
  /** Refresh the base's tree after a save (new title/timestamp). */
  onTreeRefresh: (baseId: string) => void;
  /** Pull the latest body when the tab refocuses and the editor is clean. */
  onFocusRefetch: () => void;
}

/** Toolbar pill inset for the v2 layout: rail + sidebar + list pane on the
 *  left, the floating panel's right margin on the right, so the bar centers
 *  over the detail pane rather than the viewport. */
const V2_TOOLBAR_INSET = "md:left-[650px] md:right-[14px]";

/**
 * File view — the real rich-text editor with full v1 robustness (conflict-safe
 * autosave, focus-refetch, presence, agent-facing description). The per-entry
 * body fetch + realtime live in the controller; this renders DocPane with the
 * resolved body, showing a skeleton until it lands.
 */
export function EntryView({
  base,
  metaEntry,
  fullEntry,
  status,
  workspaceId,
  onTreeRefresh,
  onFocusRefetch,
}: Props) {
  const displayEntry = fullEntry ?? metaEntry;
  // Until the full body lands, show the body skeleton instead of a blank
  // editor. False on error (don't hang the skeleton) and once the body for
  // THIS entry is in hand.
  const bodyLoading = fullEntry?.id !== metaEntry.id && status !== "error";

  return (
    <div className={styles.editorScope}>
      <DocPane
        key={displayEntry.id}
        entry={displayEntry}
        workspaceId={workspaceId}
        bodyLoading={bodyLoading}
        toolbarInset={V2_TOOLBAR_INSET}
        onSaved={() => onTreeRefresh(base.id)}
        onStaleVersion={() => onTreeRefresh(base.id)}
        onFocusRefetch={onFocusRefetch}
      />
    </div>
  );
}

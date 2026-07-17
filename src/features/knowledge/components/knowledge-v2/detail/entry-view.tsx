"use client";

import { FileWarning } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { DocPane } from "../../doc-pane";
import { DocBodySkeleton } from "../../doc-pane-chrome";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import styles from "../knowledge-v2.module.css";

interface Props {
  base: KnowledgeBase;
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
 * autosave, focus-refetch, presence, agent-facing description).
 *
 * DocPane mounts ONLY once the full entry (body + fresh `updated_at`) is in
 * hand — never the body-stripped tree entry. Mounting on tree metadata let a
 * title edit during the load window autosave `body: ""` over the whole
 * document, and seeded the concurrency token from possibly-stale tree data
 * (phantom "edited elsewhere" conflicts).
 */
export function EntryView({
  base,
  fullEntry,
  status,
  workspaceId,
  onTreeRefresh,
  onFocusRefetch,
}: Props) {
  if (!fullEntry) {
    if (status === "error") {
      return (
        <EmptyState
          icon={FileWarning}
          title="Couldn't load this file."
          description="Check your connection, then try again."
        >
          <button
            type="button"
            onClick={onFocusRefetch}
            className="btn-light rounded-md px-2.5 py-1 text-small font-medium text-text-primary"
          >
            Retry
          </button>
        </EmptyState>
      );
    }
    return (
      <div className={styles.editorScope}>
        <DocBodySkeleton />
      </div>
    );
  }

  return (
    <div className={styles.editorScope}>
      <DocPane
        key={fullEntry.id}
        entry={fullEntry}
        workspaceId={workspaceId}
        toolbarInset={V2_TOOLBAR_INSET}
        onSaved={() => onTreeRefresh(base.id)}
        onStaleVersion={() => onTreeRefresh(base.id)}
        onFocusRefetch={onFocusRefetch}
      />
    </div>
  );
}

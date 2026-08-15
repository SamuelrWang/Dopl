"use client";

import { FileWarning } from "lucide-react";
import type { Editor } from "@tiptap/react";
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
  /** Surfaces the live editor so the detail-panel header band can host the
   *  toolbar; the built-in floating pill is suppressed here. */
  onEditor?: (editor: Editor | null) => void;
}

/**
 * File view: rich-text editor with conflict-safe autosave, focus-refetch,
 * presence, agent-facing description.
 *
 * ⚠ DocPane mounts ONLY once the FULL entry (body + fresh `updated_at`) is in
 * hand, never the body-stripped tree entry. On tree metadata, a title edit
 * during the load window autosaves `body: ""` over the whole document, and the
 * concurrency token seeds from stale data (phantom "edited elsewhere").
 */
export function EntryView({
  base,
  fullEntry,
  status,
  workspaceId,
  onTreeRefresh,
  onFocusRefetch,
  onEditor,
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
        onEditor={onEditor}
        onSaved={() => onTreeRefresh(base.id)}
        onStaleVersion={() => onTreeRefresh(base.id)}
        onFocusRefetch={onFocusRefetch}
      />
    </div>
  );
}

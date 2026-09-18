"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Toolbar } from "@/shared/editor/doc-editor-toolbar";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import { EntryView } from "./entry-view";
import styles from "../knowledge-v2.module.css";

interface Props {
  base: KnowledgeBase;
  /** Full entry with body, or `null` while the fetch for THIS file is out. */
  fullEntry: KnowledgeEntry | null;
  status: "idle" | "loading" | "success" | "error";
  workspaceId: string;
  onTreeRefresh: (baseId: string) => void;
  onFocusRefetch: () => void;
}

/**
 * The file face: the formatting band plus the document, as one thing.
 *
 * The editor handle is local, which is what makes the fade safe. During a
 * crossfade two documents are mounted at once (`shared/ui/crossfade.tsx`, 150ms)
 * and a band held in the pane's state would have them take turns publishing into
 * one `useState`, the outgoing one landing last and leaving the header driving a
 * dead editor. It belongs to the document anyway — the panel header names the
 * base and survives every swap.
 */
export function FileView({
  base,
  fullEntry,
  status,
  workspaceId,
  onTreeRefresh,
  onFocusRefetch,
}: Props) {
  // Published by EntryView's DocEditor; null until the editor mounts.
  const [editor, setEditor] = useState<Editor | null>(null);

  return (
    <>
      {/* Above the scroll body so formatting stays reachable in long documents;
          empty until the editor mounts, keeping height stable. */}
      <div className={styles.detailToolbarBand}>
        {editor && <Toolbar editor={editor} variant="header" />}
      </div>

      <div className={styles.docBody}>
        {/* DocPane renders the editable title itself. */}
        <EntryView
          base={base}
          fullEntry={fullEntry}
          status={status}
          workspaceId={workspaceId}
          onEditor={setEditor}
          onTreeRefresh={onTreeRefresh}
          onFocusRefetch={onFocusRefetch}
        />
      </div>
    </>
  );
}

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
 * THE FILE FACE — the formatting band plus the document, as one thing.
 *
 * ⚠ THE EDITOR HANDLE IS LOCAL, AND THAT IS WHAT MAKES THE FADE SAFE. The band
 * used to live in the detail pane's header with the live `Editor` held in that
 * pane's state; during a crossfade TWO documents are mounted at once
 * (`shared/ui/crossfade.tsx`: the outgoing subtree stays for 150ms), and they
 * would take turns publishing into one `useState` — the outgoing one landing
 * last, leaving the header driving a dead editor. One band per document, owned
 * by the document's own face, cannot do that.
 *
 * ⚠ AND IT BELONGS TO THE DOCUMENT ANYWAY. The panel header names the BASE and
 * survives every swap; a bold/italic row is not a property of the base.
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
      {/* Always above the scroll body so formatting stays reachable in long
          documents; empty until the editor mounts, keeping height stable. */}
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

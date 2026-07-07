"use client";

/**
 * ArtifactPanelBody — workspace-shared markdown document panel.
 *
 * Two views, toggled by the eye/pencil button in the header:
 *   - Render: MarkdownMessage rendering, read-friendly.
 *   - Edit: textarea over the same markdown, persists on blur via
 *     UPDATE_ARTIFACT_MARKDOWN.
 *
 * The title is editable inline (single click). All edits flow through
 * the canvas store reducer; the existing canvas-panels DB sync layer
 * picks them up and writes to `panel_data.markdown` / `panel_data.title`.
 */

import { useRef, useState, type Dispatch } from "react";
import { Eye, Pencil } from "lucide-react";
import { MarkdownMessage } from "@/shared/design";
import type { ArtifactPanelData, CanvasAction } from "../../types";

interface ArtifactPanelBodyProps {
  panel: ArtifactPanelData;
  dispatch: Dispatch<CanvasAction>;
}

export function ArtifactPanelBody({ panel, dispatch }: ArtifactPanelBodyProps) {
  // Drafts are only meaningful while the user is editing — outside of
  // edit mode, panel.markdown / panel.title are the source of truth.
  // We snapshot them into the draft when entering edit mode (see
  // startEditingMarkdown / startEditingTitle below); no useEffect-based
  // sync is needed.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(panel.markdown);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(panel.title);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function startEditingMarkdown() {
    setDraft(panel.markdown);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }
  function startEditingTitle() {
    setTitleDraft(panel.title);
    setTitleEditing(true);
  }

  function commitMarkdown() {
    if (draft !== panel.markdown) {
      dispatch({
        type: "UPDATE_ARTIFACT_MARKDOWN",
        panelId: panel.id,
        markdown: draft,
      });
    }
    setEditing(false);
  }

  function commitTitle() {
    const next = titleDraft.trim();
    if (next && next !== panel.title) {
      dispatch({
        type: "UPDATE_ARTIFACT_TITLE",
        panelId: panel.id,
        title: next,
      });
    } else {
      setTitleDraft(panel.title);
    }
    setTitleEditing(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — title (editable) + view toggle */}
      <div
        data-no-drag
        className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border-subtle"
      >
        {titleEditing ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
              } else if (e.key === "Escape") {
                setTitleEditing(false);
              }
            }}
            autoFocus
            className="flex-1 bg-transparent outline-none text-[13px] font-medium text-text-primary border-b border-border-strong"
          />
        ) : (
          <button
            type="button"
            onClick={startEditingTitle}
            className="flex-1 text-left text-[13px] font-medium text-text-primary truncate hover:text-text-primary cursor-text"
          >
            {panel.title}
          </button>
        )}
        <button
          type="button"
          onClick={editing ? commitMarkdown : startEditingMarkdown}
          aria-label={editing ? "View" : "Edit"}
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-secondary/70 hover:bg-surface-raised-3 hover:text-text-primary transition-colors cursor-pointer"
        >
          {editing ? <Eye size={13} /> : <Pencil size={13} />}
        </button>
      </div>

      {/* Body */}
      <div data-no-drag className="flex-1 min-h-0 overflow-y-auto">
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitMarkdown}
            className="w-full h-full p-4 bg-transparent outline-none resize-none text-[13px] leading-relaxed text-text-primary/90 font-mono"
            placeholder="Start writing markdown…"
          />
        ) : (
          <div className="p-4 text-[13.5px] leading-relaxed text-text-primary/90">
            <MarkdownMessage content={panel.markdown || "*Empty artifact.*"} />
          </div>
        )}
      </div>
    </div>
  );
}

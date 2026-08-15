"use client";

import { useState } from "react";
import { Folder } from "lucide-react";

/** Inline folder chip: click to assign or rename, blank to unfile. Read-only
 *  members see the label only, and nothing at all when unfiled. */
export function SkillFolderControl({
  folder,
  canEdit,
  onSave,
}: {
  folder: string | null;
  canEdit: boolean;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder ?? "");
  // Re-sync the draft on committed-folder change (adjust-state-during-render).
  const [lastFolder, setLastFolder] = useState(folder);
  if (lastFolder !== folder) {
    setLastFolder(folder);
    setDraft(folder ?? "");
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim() === "" ? null : draft.trim();
    if (next !== (folder ?? null)) void onSave(next);
  };

  if (!canEdit) {
    if (!folder) return null;
    return (
      <span className="flex shrink-0 items-center gap-1 text-caption text-text-muted">
        <Folder size={11} />
        {folder}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(folder ?? "");
            setEditing(false);
          }
        }}
        placeholder="Folder"
        aria-label="Skill folder"
        className="concave-field h-6 w-32 rounded-md px-2 text-caption text-text-primary"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={folder ? `Folder: ${folder}` : "Add to a folder"}
      className="btn-light flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-caption text-text-secondary"
    >
      <Folder size={11} />
      {folder ?? "Add folder"}
    </button>
  );
}

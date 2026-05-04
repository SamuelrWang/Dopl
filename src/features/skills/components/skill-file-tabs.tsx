"use client";

import { useState } from "react";
import { FileText, Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PRIMARY_SKILL_FILE_NAME, type SkillFile } from "@/features/skills/types";

/** Mirrors the server-side `SkillFileNameSchema` regex (schema.ts). */
const FILE_NAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\.md$/;

/**
 * Best-effort cleanup of a user-typed file name. Lower-cases a stray
 * `.MD` extension, appends `.md` when missing, and replaces whitespace
 * runs with a single hyphen. Returns null if the result still doesn't
 * match the server regex — caller should keep the rename input open
 * and surface an inline error instead of firing the API call.
 */
function sanitizeFileName(input: string): string | null {
  let name = input.trim();
  if (!name) return null;
  // Collapse interior whitespace runs to a single hyphen.
  name = name.replace(/\s+/g, "-");
  // Lower-case a stray uppercase `.MD` / `.Md` extension.
  if (/\.md$/i.test(name) && !/\.md$/.test(name)) {
    name = name.replace(/\.md$/i, ".md");
  }
  // Append `.md` if missing.
  if (!/\.md$/.test(name)) name = `${name}.md`;
  return FILE_NAME_REGEX.test(name) ? name : null;
}

interface FileTabsProps {
  files: SkillFile[];
  activeId: string;
  /** Audit A-005 / A-013: gate "+ Add file" / delete / rename on
   *  effective access. Read-only members can still switch tabs. */
  canEdit?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (file: SkillFile) => void;
  onRename: (file: SkillFile, newName: string) => void;
}

/**
 * Horizontal tab strip over a skill's `.md` files. SKILL.md is pinned
 * leftmost and is non-removable / non-renamable. Double-click any
 * other tab name to rename. The "+ Add file" button at the end calls
 * `onAdd` which the parent wires to the API.
 */
export function FileTabs({
  files,
  activeId,
  canEdit = true,
  onSelect,
  onAdd,
  onRemove,
  onRename,
}: FileTabsProps) {
  return (
    <div className="flex items-stretch border-b border-white/[0.06] px-2 overflow-x-auto">
      {files.map((file) => (
        <FileTab
          key={file.id}
          file={file}
          active={file.id === activeId}
          canEdit={canEdit}
          onSelect={() => onSelect(file.id)}
          onRemove={() => onRemove(file)}
          onRename={(name) => onRename(file, name)}
        />
      ))}
      {canEdit && (
        <button
          type="button"
          onClick={onAdd}
          className="ml-1 my-1.5 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary/70 hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus size={11} />
          Add file
        </button>
      )}
    </div>
  );
}

function FileTab({
  file,
  active,
  canEdit,
  onSelect,
  onRemove,
  onRename,
}: {
  file: SkillFile;
  active: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const isPrimary = file.name === PRIMARY_SKILL_FILE_NAME;
  // The component is keyed by file.id at the parent; when the server
  // replaces the row (e.g. after a rename), React remounts and the
  // initializer below picks up the fresh name. No effect needed.
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(file.name);
  const [error, setError] = useState<string | null>(null);

  function commitRename() {
    if (!draft.trim() || draft.trim() === file.name) {
      setRenaming(false);
      setError(null);
      return;
    }
    const sanitized = sanitizeFileName(draft);
    if (!sanitized) {
      setError("Use letters, numbers, ., _, - and end in .md");
      return; // keep input open so the user can fix it
    }
    setRenaming(false);
    setError(null);
    onRename(sanitized);
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1.5 pl-3 pr-2 cursor-pointer transition-colors",
        active
          ? "text-text-primary"
          : "text-text-secondary hover:text-text-primary"
      )}
      onClick={onSelect}
    >
      <FileText size={11} className="opacity-70 shrink-0" />
      {renaming ? (
        <span className="flex items-center gap-1.5">
          <input
            autoFocus
            // Audit A-017: select-all on focus so typing replaces the
            // current name without ⌘A. Matches InlineEditableRow's
            // `selectAllOnMount` behavior. The bespoke input here
            // (rather than the shared component) is preserved so the
            // sanitize-and-keep-draft inline-error UX can stay.
            onFocus={(e) => e.currentTarget.select()}
            value={draft}
            // Audit A-015: cap at the server's `SkillFileNameSchema` max.
            maxLength={120}
            aria-label="Skill file name"
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onBlur={commitRename}
            onKeyDown={(e) => {
              // Audit A-006: skip Enter / Escape while a CJK IME is
              // composing — those keys are for candidate selection,
              // not for our rename flow.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") {
                setDraft(file.name);
                setError(null);
                setRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "bg-transparent border rounded px-1 py-0.5 text-[12px] font-mono w-32 outline-none",
              error
                ? "border-red-500/50 focus:border-red-500/70"
                : "border-white/[0.1] focus:border-white/[0.2]"
            )}
          />
          {error && (
            <span className="text-[10px] text-red-400/90 max-w-[180px] truncate">
              {error}
            </span>
          )}
        </span>
      ) : (
        <span
          className="text-[12px] font-mono py-2"
          onDoubleClick={(e) => {
            if (isPrimary) return;
            // Audit A-013: read-only members can't double-click to
            // rename — server would reject anyway.
            if (!canEdit) return;
            e.stopPropagation();
            setDraft(file.name);
            setRenaming(true);
          }}
        >
          {file.name}
        </span>
      )}
      {!isPrimary && !renaming && canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${file.name}`}
          className="opacity-0 group-hover:opacity-100 w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.06] transition-opacity"
        >
          <X size={10} className="text-text-secondary/70" />
        </button>
      )}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-px bg-text-primary" />
      )}
    </div>
  );
}

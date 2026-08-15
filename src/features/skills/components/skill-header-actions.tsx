"use client";

import { useState } from "react";
import { Copy, Download, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import type { Skill } from "@/features/skills/types";
import { duplicateSkill } from "@/features/skills/client/api";
import { errMessage } from "./skill-view-utils";

/** Export / duplicate / delete cluster, with the permanent-delete confirm. */
export function SkillHeaderActions({
  slug,
  workspaceId,
  canEdit,
  onDuplicated,
  onListChanged,
  onDelete,
}: {
  slug: string;
  workspaceId: string;
  canEdit: boolean;
  onDuplicated?: (skill: Skill) => void;
  onListChanged?: () => void;
  /** Omitted when the caller may not delete — button and dialog then don't
   *  render at all. */
  onDelete?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
      <a
        // ⚠ A plain download link can't send X-Workspace-Id, so the export
        // scopes via `?workspaceId=` (membership-checked server-side).
        href={`/api/skills/${encodeURIComponent(slug)}/export?workspaceId=${encodeURIComponent(workspaceId)}`}
        download
        title="Download as a Claude-Code-compatible skill zip"
        className="btn-light flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
      >
        <Download size={12} />
        Export
      </a>
      {canEdit && (
        <button
          type="button"
          disabled={busy}
          title="Fork into a new private draft"
          onClick={async () => {
            setBusy(true);
            try {
              const created = await duplicateSkill(slug, workspaceId);
              toast({ title: "Skill duplicated", description: created.skill.name });
              onDuplicated?.(created.skill);
              onListChanged?.();
              setBusy(false);
            } catch (err) {
              toast({ title: "Couldn't duplicate", description: errMessage(err) });
              setBusy(false);
            }
          }}
          className="btn-light flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary disabled:opacity-50"
        >
          <Copy size={12} />
          {busy ? "Duplicating…" : "Duplicate"}
        </button>
      )}
      {onDelete && (
        <>
          <button
            type="button"
            title="Permanently delete this skill"
            onClick={() => setConfirmDelete(true)}
            className="btn-light flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-danger"
          >
            <Trash2 size={12} />
            Delete
          </button>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this skill?"
            description="This permanently deletes the skill. This can't be undone."
            confirmLabel="Delete permanently"
            destructive
            onConfirm={onDelete}
          />
        </>
      )}
    </>
  );
}

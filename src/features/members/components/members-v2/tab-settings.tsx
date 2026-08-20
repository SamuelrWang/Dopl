"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { AssignableRole, WorkspaceMemberView } from "../../types";
import { RolePill, RoleSelect } from "../member-bits";
import { PaneHeading } from "./bits";
import { displayNameOf } from "./view-model";
import type { MemberVisibility } from "./visibility";

/**
 * ⚠ NO PER-MEMBER PREFERENCES HERE, and that is deliberate. Per-member settings
 * are private by COLUMN PRIVILEGE (docs/INVARIANTS.md §2) — an admin managing a
 * role is workspace administration, reading somebody's preferences is reading a
 * private column. Nothing on this pane is per-member state; if one is ever
 * added it owes §2's two edits (DTO scrub AND omission from the GRANT list).
 */
export function SettingsTab({
  member: m,
  visibility,
  busy,
  onRoleChange,
  onRemove,
}: {
  member: WorkspaceMemberView;
  visibility: MemberVisibility;
  busy: boolean;
  onRoleChange: (role: AssignableRole) => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="flex flex-col gap-3.5">
      <PaneHeading title="Settings" subtitle="How this member is scoped in the workspace." />

      <SectionBox label="Role">
        <div className="flex items-center gap-3 px-3 py-2.5">
          {visibility.showRolePicker && m.role !== "owner" ? (
            <>
              <RoleSelect
                value={m.role as AssignableRole}
                onChange={onRoleChange}
                disabled={busy}
              />
              <p className="text-caption leading-relaxed text-text-secondary">
                Takes effect the next time {displayNameOf(m)} loads the workspace.
              </p>
            </>
          ) : (
            <>
              <RolePill role={m.role} />
              <p className="text-caption leading-relaxed text-text-secondary">
                {roleLockCopy(m, visibility)}
              </p>
            </>
          )}
        </div>
      </SectionBox>

      {visibility.showDangerZone && (
        <SectionBox label="Danger zone">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-danger/10 text-danger">
              <Trash2 size={13} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body text-text-primary">
                Remove from workspace
              </span>
              <span className="block text-caption leading-relaxed text-text-secondary">
                Drops the membership and every team grant it carried. No undo.
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
              className="shrink-0 cursor-pointer rounded-full border border-danger/30 bg-danger/10 px-3 py-1 text-small font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </SectionBox>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${displayNameOf(m)}?`}
        description="They lose access to every knowledge base, skill and chat this workspace scoped to them, and are removed from its channels."
        confirmLabel="Remove"
        destructive
        onConfirm={onRemove}
      />
    </div>
  );
}

/** The three `MemberManageDenial` cases, said in words rather than left as a
 *  missing control. */
function roleLockCopy(m: WorkspaceMemberView, visibility: MemberVisibility): string {
  if (visibility.isSelf) return "You cannot change your own role.";
  if (m.role === "owner") {
    return "The owner role is reassigned by transferring ownership, not from this pane.";
  }
  if (m.role === "admin") return "Only the owner can change an admin's role.";
  return "You do not have permission to change this member's role.";
}

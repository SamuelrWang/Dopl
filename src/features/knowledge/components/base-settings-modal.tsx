"use client";

import { X } from "lucide-react";
// Deep import, not the `settings-modal` barrel: the barrel also re-exports
// SettingsModal, whose delete-account section pulls in `next/navigation` and
// would drag Next into the desktop SPA's import graph.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase, KnowledgeFolder } from "../types";
import type { KnowledgeRouting } from "./knowledge-v2/routing";
import { BaseSettingsForm } from "./base-settings-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
  currentUserId: string;
  role: Role;
  /** Active folders in the base — each gets an agent-facing description
   *  editor in the Descriptions section. */
  folders: KnowledgeFolder[];
  /** Called after a folder description saves so the parent can refresh
   *  its tree snapshot. */
  onFoldersChanged?: () => void;
  /** Router bindings for the form's slug-change / delete moves. */
  routing: KnowledgeRouting;
}

/**
 * Per-KB settings dialog in the new design language: the shared
 * ModalShell (scrim + fade/pop-in card + light token scope) in its
 * narrow single-pane size, wrapping the existing token-based form.
 */
export function BaseSettingsModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  base,
  currentUserId,
  role,
  folders,
  onFoldersChanged,
  routing,
}: Props) {
  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      label={`${base.name} settings`}
      size="narrow"
    >
      <button
        type="button"
        className={modalStyles.close}
        onClick={() => onOpenChange(false)}
        aria-label="Close settings"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle}>{base.name} settings</h2>
        <p className={modalStyles.narrowPath}>
          /{workspaceSlug}/knowledge/{base.slug}
        </p>
        <BaseSettingsForm
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          base={base}
          folders={folders}
          currentUserId={currentUserId}
          role={role}
          onFoldersChanged={onFoldersChanged}
          routing={routing}
        />
      </div>
    </ModalShell>
  );
}

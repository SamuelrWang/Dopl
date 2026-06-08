"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { KnowledgeBase } from "../types";
import { BaseSettingsForm } from "./base-settings-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
  base: KnowledgeBase;
}

export function BaseSettingsModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  base,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-modal-surface border-border-strong text-text-primary max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-text-primary">{base.name} settings</DialogTitle>
          <DialogDescription className="text-text-muted font-mono text-[11px]">
            /{workspaceSlug}/knowledge/{base.slug}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <BaseSettingsForm
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            base={base}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

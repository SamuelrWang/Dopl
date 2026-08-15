"use client";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

/**
 * The ONE permanent-delete confirmation for a knowledge base. Two surfaces
 * open it (settings danger zone, detail-panel header menu); ⚠ keep the copy
 * here so the two can't drift.
 */
export function DeleteBaseConfirm({
  open,
  onOpenChange,
  baseName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseName: string;
  /** ⚠ ConfirmDialog contract: throwing keeps the dialog open for a retry,
   *  resolving closes it. */
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete knowledge base?"
      description={`This permanently deletes “${baseName}” and all its folders and entries. This can't be undone.`}
      confirmLabel="Delete permanently"
      destructive
      onConfirm={onConfirm}
    />
  );
}

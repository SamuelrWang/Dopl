"use client";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

/**
 * The one permanent-delete confirmation for a knowledge base.
 *
 * Two surfaces open it — the settings form's danger zone and the v2 detail
 * panel's header menu — and they carried byte-identical copies of the dialog
 * until this component. Keep the copy here so the two can't drift.
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
  /** Throwing keeps the dialog open so the user can retry (ConfirmDialog's
   *  contract); resolving closes it. */
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

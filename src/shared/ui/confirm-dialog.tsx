"use client";

import { useState } from "react";
// Deep import, not the `settings-modal` barrel: the barrel also re-exports
// SettingsModal, whose section tree reaches `next/navigation`. This dialog is a
// leaf primitive reused by pages the desktop SPA bundles, where a `next/*`
// module anywhere in the graph fails the build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import styles from "@/shared/layout/settings-modal/settings-modal.module.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Supporting copy. Newlines render as paragraph breaks. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  /** Called when the user confirms. May be async — the dialog shows a
   *  busy state and closes on resolve; a throw keeps it open (the
   *  caller is expected to toast the error). */
  onConfirm: () => void | Promise<void>;
}

/**
 * In-app confirmation dialog in the new design language — replaces
 * `window.confirm`. Built on ModalShell (scrim + fade/pop animation)
 * in its compact size.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller surfaces the error (toast); keep the dialog open so the
      // user can retry or cancel.
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      label={title}
      size="compact"
    >
      <div className={styles.confirmBody}>
        <h2 className={styles.confirmTitle}>{title}</h2>
        {description ? <p className={styles.confirmDesc}>{description}</p> : null}
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.btnCancel}
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? styles.btnDanger : styles.btnConfirm}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

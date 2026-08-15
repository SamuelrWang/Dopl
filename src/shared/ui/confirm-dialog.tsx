"use client";

import { useState } from "react";
// ⚠ Deep import, NOT the `settings-modal` barrel — the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`, and any `next/*`
// module in the graph fails the desktop SPA build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import styles from "@/shared/layout/settings-modal/settings-modal.module.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Newlines render as paragraph breaks. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** May be async: busy state, closes on resolve. A throw keeps it open —
   *  caller toasts the error. */
  onConfirm: () => void | Promise<void>;
}

/** In-app confirmation — use instead of `window.confirm`. Compact ModalShell. */
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
      // Caller toasts; stay open so the user can retry or cancel.
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

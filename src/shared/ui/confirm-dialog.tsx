"use client";

import { cn } from "@/shared/lib/utils";
import { useState } from "react";
// Deep import of `modal-shell`, as every dialog in this kit does. The `settings-modal`
// barrel used to re-export the web SettingsModal and so reached `next/navigation`; that
// modal was deleted 2026-10-11 (cleanup ST1) and the barrel is Next-free now.
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
            className={cn("btn-light", styles.btn)}
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn(styles.btn, destructive ? styles.btnDanger : cn("auth-btn-3d", styles.btnConfirm))}
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

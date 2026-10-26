"use client";

/**
 * STAGING COPY of `src/shared/layout/settings-modal/modal-shell.tsx › ModalShell` — the portal,
 * the two-frame enter/exit, the Escape key, the scrim click and the body-scroll lock, verbatim.
 * Copied rather than reused because the view popup is a FIXED box whose body scrolls, and `size`
 * on the shared shell offers `wide | narrow | compact`, none of which is that (see the CSS
 * module's header for the three differences and the port target).
 *
 * ⚠ Behaviour is deliberately byte-for-byte: every state write sits inside a rAF/timeout callback,
 * never synchronously in the effect body, or the transition loses its separate paints.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/utils";
import styles from "./identity-view.module.css";

export function IdentityModalShell({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  label: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => {
        setMounted(true);
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }
    let unmountTimer: ReturnType<typeof setTimeout>;
    const id = requestAnimationFrame(() => {
      setVisible(false);
      unmountTimer = setTimeout(() => setMounted(false), 220);
    });
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(unmountTimer);
    };
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(styles.overlay, visible && styles.overlayVisible)}
      onMouseDown={onClose}
    >
      <div
        className={cn(styles.scope, styles.card, visible && styles.cardVisible)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

/** The X, so the header owns its own geometry (`identity-view.module.css › .close`). */
export const IDENTITY_MODAL_CLOSE = styles.close;

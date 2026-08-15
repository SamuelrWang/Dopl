"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/utils";
import styles from "./settings-modal.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  label: string;
  /** `wide` = full settings page card; `narrow` = single-pane dialog;
   *  `compact` = small confirm dialog. */
  size?: "wide" | "narrow" | "compact";
  children: React.ReactNode;
}

/**
 * Portal modal: scrim + card that fades/pops. Mounts on open, animates via the
 * `.visible` classes a frame later, stays mounted through the exit transition.
 * Closes on scrim click or Escape; locks body scroll while open. Card carries
 * the light token scope so embedded components render light in any app theme.
 */
export function ModalShell({ open, onClose, label, size = "wide", children }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // ⚠ Every state write sits inside a rAF/timeout callback, never synchronously
  // in the effect body: the transition needs separate paints, and the
  // set-state-in-effect lint rule forbids the direct version.
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
        className={cn(
          styles.scope,
          styles.card,
          size === "narrow" && styles.cardNarrow,
          size === "compact" && styles.cardCompact,
          visible && styles.cardVisible,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

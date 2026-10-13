"use client";

/**
 * Minimal toast primitive, no external dependency: one active toast at a time, bottom-right,
 * auto-dismiss after 4s; the call shape matches sonner/radix-toast. Mount `<ToastHost />` once at
 * the root and fire `toast({ title, description, action })` from any client component.
 * `variant: "invert"` is the small black one-line face. A variant, not a second host: two hosts
 * would stack two "only" toasts in the same corner.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** The light card (default) or the small black line. */
type ToastVariant = "default" | "invert";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastData {
  id: number;
  title: string;
  description?: string;
  action?: ToastAction;
  onBodyClick?: () => void;
  durationMs: number;
  variant: ToastVariant;
}

type Listener = (t: ToastData | null) => void;

let nextId = 1;
const listeners = new Set<Listener>();
let currentToast: ToastData | null = null;

function setCurrent(t: ToastData | null) {
  currentToast = t;
  for (const l of listeners) l(t);
}

/** The `invert` face renders only the title, so its options carry nothing else (F25). */
export type ToastOptions =
  | {
      title: string;
      description?: string;
      action?: ToastAction;
      /**
       * 🔒 **THE WHOLE CARD IS THE CONTROL** (Samuel, 2026-10-12, ruling on the in-app mention
       * pop-up: *"whole in-app mention pop-up clickable, jumps to the message"*, with the 4s
       * dismiss kept and no button added).
       *
       * ⚠ **IT IS NOT AN `action`.** An action renders a BUTTON and a mention toast was ruled to
       * have none; this is the card itself answering a click. Both may be set — the button wins
       * its own click, because it stops the event rather than letting it reach the card.
       * ⚠ **DISMISS AND THE ACTION BUTTON ARE NOT PART OF IT.** Both stop propagation, so "close
       * this" can never be read as "open the thing".
       */
      onBodyClick?: () => void;
      durationMs?: number;
      variant?: "default";
    }
  | { title: string; durationMs?: number; variant: "invert" };

export function toast(opts: ToastOptions) {
  const id = nextId++;
  setCurrent({
    id,
    title: opts.title,
    description: opts.variant === "invert" ? undefined : opts.description,
    action: opts.variant === "invert" ? undefined : opts.action,
    // The black line reports something already done and carries no controls (see its branch
    // below), so a click target on it would be a promise the face does not make.
    onBodyClick: opts.variant === "invert" ? undefined : opts.onBodyClick,
    durationMs: opts.durationMs ?? 4000,
    variant: opts.variant ?? "default",
  });
}

export function ToastHost() {
  const [active, setActive] = useState<ToastData | null>(currentToast);

  useEffect(() => {
    const listener: Listener = (t) => setActive(t);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // Auto-dismiss; restarts when a new toast replaces the previous one (by `.id`).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      // Only clear if this toast is still current, or a newer one arriving mid-timeout is wiped.
      if (currentToast?.id === active.id) setCurrent(null);
    }, active.durationMs);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  // The black face carries no controls: it reports something already done, with nothing to undo.
  if (active.variant === "invert") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[9999] max-w-xs rounded-lg bg-surface-invert px-3 py-2 text-caption text-text-on-invert shadow-[var(--shadow-elevated)] animate-in fade-in slide-in-from-right-4 duration-200"
      >
        <span className="block truncate" title={active.title}>
          {active.title}
        </span>
      </div>
    );
  }

  /**
   * One-shot: the card goes before the handler runs, so a second activation inside the same
   * frame has nothing to act on and a click arriving after the auto-dismiss never happens at all
   * (the card is unmounted). ⚠ The handler is read off `active` rather than re-read from the
   * module global, which a dismissal has already cleared.
   */
  const fireBody = () => {
    const fn = active.onBodyClick;
    if (!fn) return;
    setCurrent(null);
    fn();
  };
  const clickable = Boolean(active.onBodyClick);

  return (
    <div
      role="status"
      aria-live="polite"
      // ⚠ THE WHOLE CARD, which is the ruling — not just the text block. The two buttons inside
      // stop propagation, so this can only ever be reached by a click on the card itself.
      onClick={clickable ? fireBody : undefined}
      className={`fixed bottom-4 right-4 z-[9999] max-w-sm rounded-lg border border-border-strong bg-modal-surface shadow-[var(--shadow-elevated)] px-4 py-3 flex items-start gap-3 text-text-primary animate-in fade-in slide-in-from-bottom-2 duration-200${
        clickable ? " cursor-pointer" : ""
      }`}
    >
      {/*
        ⚠ KEYBOARD REACHES IT THROUGH A REAL `<button>`, not `role="button"` on the card. The card
        already owns `role="status"` for the announcement and an element has ONE role, so faking a
        second one there would cost the live region. A real button brings focus, Enter and Space
        with it — none of them hand-rolled — and `stopPropagation` keeps its click from also
        bubbling to the card and firing twice.
      */}
      {clickable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fireBody();
          }}
          className="flex-1 min-w-0 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <div className="text-body font-medium text-text-primary">{active.title}</div>
          {active.description && (
            <div className="mt-0.5 text-caption text-text-tertiary truncate" title={active.description}>
              {active.description}
            </div>
          )}
        </button>
      ) : (
        <div className="flex-1 min-w-0">
          <div className="text-body font-medium text-text-primary">{active.title}</div>
          {active.description && (
            <div className="mt-0.5 text-caption text-text-tertiary truncate" title={active.description}>
              {active.description}
            </div>
          )}
        </div>
      )}
      {active.action && (
        <button
          type="button"
          onClick={(e) => {
            // ⚠ The button's own verb, never also the card's.
            e.stopPropagation();
            active.action?.onClick();
            setCurrent(null);
          }}
          className="shrink-0 h-7 px-2.5 rounded-md bg-surface-invert text-text-on-invert text-small font-medium hover:bg-surface-invert transition-colors"
        >
          {active.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          // ⚠ "Close this" must never be read as "open the thing".
          e.stopPropagation();
          setCurrent(null);
        }}
        className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

"use client";

/**
 * Minimal toast primitive — no external dependency. ONE active toast at a time,
 * bottom-right, auto-dismiss after 4s. Call shape matches sonner/radix-toast so
 * either can be swapped in without touching call sites.
 *
 * Mount `<ToastHost />` once at the root; fire `toast({title, description,
 * action})` from any client component.
 *
 * ⚠ **TWO FACES, ONE HOST (2026-09-22, Samuel's agent-card launch ruling: *"a
 * notification popup, small, black, bottom right of the screen"*).** The default
 * face is the light card every existing caller already fires; `variant:
 * "invert"` is the SMALL BLACK one — one line, no chrome, auto-dismiss only.
 * ⚠ **IT IS A VARIANT RATHER THAN A SECOND PRIMITIVE** because a second host
 * would be a second "one active toast at a time" — two stacked popups in the
 * same corner, each certain it is alone.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** The light card (default) or the small black line. */
export type ToastVariant = "default" | "invert";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastData {
  id: number;
  title: string;
  description?: string;
  action?: ToastAction;
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

/** ⚠ The `invert` face renders only the title, so its options carry nothing else (F25). */
export type ToastOptions =
  | {
      title: string;
      description?: string;
      action?: ToastAction;
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
      // ⚠ Only clear if THIS toast is still current, or a newer one arriving
      // mid-timeout gets wiped.
      if (currentToast?.id === active.id) setCurrent(null);
    }, active.durationMs);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  // ⚠ **THE BLACK FACE CARRIES NO CONTROLS, AND THAT IS THE POINT.** It reports
  // something that already happened — an agent is running — so there is nothing
  // to undo and nothing to dismiss: it slides in from the right and goes on its
  // own. A × on a one-line report is more chrome than report.
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

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-lg border border-border-strong bg-modal-surface shadow-[var(--shadow-elevated)] px-4 py-3 flex items-start gap-3 text-text-primary animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex-1 min-w-0">
        <div className="text-body font-medium text-text-primary">{active.title}</div>
        {active.description && (
          <div className="mt-0.5 text-caption text-text-tertiary truncate" title={active.description}>
            {active.description}
          </div>
        )}
      </div>
      {active.action && (
        <button
          type="button"
          onClick={() => {
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
        onClick={() => setCurrent(null)}
        className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

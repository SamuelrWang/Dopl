"use client";

/**
 * Minimal toast primitive — no external dependency. ONE active toast at a time,
 * bottom-right, auto-dismiss after 4s. Call shape matches sonner/radix-toast so
 * either can be swapped in without touching call sites.
 *
 * Mount `<ToastHost />` once at the root; fire `toast({title, description,
 * action})` from any client component.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

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
}

type Listener = (t: ToastData | null) => void;

let nextId = 1;
const listeners = new Set<Listener>();
let currentToast: ToastData | null = null;

function setCurrent(t: ToastData | null) {
  currentToast = t;
  for (const l of listeners) l(t);
}

export function toast(opts: {
  title: string;
  description?: string;
  action?: ToastAction;
  durationMs?: number;
}) {
  const id = nextId++;
  setCurrent({
    id,
    title: opts.title,
    description: opts.description,
    action: opts.action,
    durationMs: opts.durationMs ?? 4000,
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

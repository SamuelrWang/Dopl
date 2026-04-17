"use client";

/**
 * Minimal toast primitive — no external dependency.
 *
 * Single active toast at a time, fixed bottom-right, auto-dismisses
 * after 4s, supports a title, optional description, and optional
 * action button. Designed to be easy to swap for sonner / radix-toast
 * later — the call site (`toast({ title, description, action })`) is
 * the same shape both libraries accept.
 *
 * Usage:
 *   // Mount once at the root
 *   <ToastHost />
 *
 *   // Fire from anywhere (client component)
 *   import { toast } from "@/components/ui/toast";
 *   toast({ title: "Share link copied", description: url, action: { label: "Open", onClick: () => {} } });
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

  // Auto-dismiss timer — restarts whenever a new toast replaces the
  // previous one (keyed on `.id`).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      // Only clear if this specific toast is still current — avoids
      // wiping a newer toast that arrived during the timeout.
      if (currentToast?.id === active.id) setCurrent(null);
    }, active.durationMs);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-lg border border-white/[0.12] bg-[#0a0a0a] shadow-2xl shadow-black/60 px-4 py-3 flex items-start gap-3 text-white animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{active.title}</div>
        {active.description && (
          <div className="mt-0.5 text-xs text-white/50 truncate" title={active.description}>
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
          className="shrink-0 h-7 px-2.5 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors"
        >
          {active.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => setCurrent(null)}
        className="shrink-0 text-white/40 hover:text-white/80 transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

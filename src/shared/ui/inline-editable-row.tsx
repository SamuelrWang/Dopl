"use client";

/**
 * InlineEditableRow — compact, autofocused text input designed to slot
 * into a tree row, file tab, or sidebar list item where we'd previously
 * have fired `window.prompt(...)`.
 *
 * Two distinct flows it supports:
 *
 * 1. **Create flow** (parent first creates the row server-side with a
 *    default name like "Untitled folder", then renders this component
 *    in the just-created row's slot to let the user immediately rename).
 *    Pass `selectAllOnMount` so typing replaces the placeholder, and
 *    `onCancel` to delete the stub when the user hits Escape on an
 *    untouched default.
 *
 * 2. **Rename flow** (existing row toggled into editing state via a
 *    context menu or double-click). Don't pass `onCancel` — Escape
 *    just exits editing and reverts the displayed text.
 *
 * In both flows: Enter / blur commit, Escape cancels. The component
 * leaves nothing focused after committing or cancelling — the parent
 * can react by clearing its `editing` state.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** Initial text in the input. */
  value: string;
  /**
   * Called with the trimmed value when the user commits (Enter or
   * blur with a non-empty change). The parent should issue the
   * actual rename API call and clear its `editing` state on resolve.
   * Throwing rolls back to `value` and stays in editing mode.
   */
  onCommit: (next: string) => Promise<void> | void;
  /**
   * Called when the user explicitly cancels with Escape. In a
   * create-then-rename flow this should DELETE the stub row and
   * clear the parent's `editing` state. In a pure rename flow,
   * leave undefined — the component just exits editing.
   */
  onCancel?: () => Promise<void> | void;
  /** Select the entire value on mount (default: false). Ideal for
   *  create flows where the placeholder name is meant to be replaced. */
  selectAllOnMount?: boolean;
  placeholder?: string;
  className?: string;
  /** Optional small icon rendered to the left of the input (e.g. a
   *  Folder or FileText glyph) so the inline-edit state visually
   *  matches the row it replaces. */
  iconBefore?: React.ReactNode;
  /** Tailwind size override for the input. Default sized for tree rows. */
  inputClassName?: string;
}

export function InlineEditableRow({
  value,
  onCommit,
  onCancel,
  selectAllOnMount = false,
  placeholder,
  className,
  iconBefore,
  inputClassName,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Set true once the user successfully commits OR explicitly cancels
   * — guards the onBlur handler from firing a duplicate commit when
   * we programmatically blur after a keystroke.
   */
  const settledRef = useRef(false);
  /** Set true while the cancel callback is running so onBlur doesn't
   *  also try to commit the in-flight Escape. */
  const cancellingRef = useRef(false);

  // Autofocus + optional select-all on mount. Use useLayoutEffect so
  // the focus happens before paint and the user doesn't see a flash
  // of unfocused input.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (selectAllOnMount) el.select();
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep draft in sync with `value` if the parent updates it while
  // we're not focused (rare — usually the parent just unmounts us).
  useEffect(() => {
    if (
      typeof document !== "undefined" &&
      document.activeElement !== inputRef.current
    ) {
      setDraft(value);
    }
  }, [value]);

  async function commit() {
    if (settledRef.current || cancellingRef.current) return;
    const next = draft.trim();
    if (!next || next === value.trim()) {
      // Nothing meaningful changed — treat as a no-op cancel. We do
      // NOT call onCancel here; that's reserved for explicit Escape.
      settledRef.current = true;
      return;
    }
    setBusy(true);
    try {
      await onCommit(next);
      settledRef.current = true;
    } catch {
      // Stay in editing mode; revert draft to the original value so the
      // user can retry or escape out.
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (settledRef.current) return;
    cancellingRef.current = true;
    try {
      if (onCancel) await onCancel();
    } finally {
      settledRef.current = true;
      cancellingRef.current = false;
    }
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {iconBefore}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            void cancel();
            inputRef.current?.blur();
          }
        }}
        onBlur={() => {
          // Skip if Escape just settled this; commit otherwise.
          if (settledRef.current || cancellingRef.current) return;
          void commit();
        }}
        className={cn(
          "min-w-0 flex-1 rounded border border-white/[0.18] bg-white/[0.04]",
          "px-1.5 py-0.5 text-[12px] text-white/95 placeholder:text-white/30",
          "focus:border-white/[0.3] focus:bg-white/[0.06] focus:outline-none",
          "disabled:opacity-60",
          inputClassName,
        )}
      />
    </div>
  );
}

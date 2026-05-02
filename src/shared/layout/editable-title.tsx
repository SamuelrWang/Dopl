"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** Authoritative title from the server. Used to seed the input and
   *  to revert when the user blurs without committing. */
  value: string;
  /**
   * Called with the new title when the user commits (Enter or blur
   * with a non-empty change). Returning a Promise lets the caller
   * surface server errors back via the optional onError callback.
   */
  onSave: (next: string) => Promise<void> | void;
  /** Optional handler invoked when onSave throws. Defaults to a console
   *  warning. The component reverts the input to `value` on error. */
  onError?: (err: unknown) => void;
  /** Placeholder shown when the value is empty. */
  placeholder?: string;
  className?: string;
}

/**
 * Inline-editable title rendered as a single text input that mimics
 * the surrounding heading style. Click to start editing — the input
 * is always focusable, so a single click positions the caret. Press
 * Enter to commit, Escape to revert, or click away to commit on blur.
 *
 * The component owns local typing state and only fires `onSave` when
 * the value actually changes, so empty / unchanged blurs don't
 * round-trip a save. Server-side rename errors revert the displayed
 * text to the last known good value via an effect on the `value` prop.
 */
export function EditableTitle({
  value,
  onSave,
  onError,
  placeholder = "Untitled",
  className,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Latest value from props — used to revert on Escape / blur-without-
  // change and to keep the input in sync with external updates while
  // the field isn't focused.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
    // Sync from prop only when the input isn't focused — avoids
    // clobbering the user's mid-type characters when the row refetches.
    if (
      typeof document !== "undefined" &&
      document.activeElement !== inputRef.current
    ) {
      setDraft(value);
    }
  }, [value]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  async function commit() {
    const next = draft.trim();
    if (!next || next === valueRef.current) {
      // No-op — revert to canonical value.
      setDraft(valueRef.current);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      // Revert + notify caller.
      setDraft(valueRef.current);
      if (onError) {
        onError(err);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[EditableTitle] save failed", err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      placeholder={placeholder}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inputRef.current?.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(valueRef.current);
          inputRef.current?.blur();
        }
      }}
      onBlur={() => {
        void commit();
      }}
      // Click on the input naturally positions the caret; no extra
      // handling needed.
      className={cn(
        "min-w-0 truncate bg-transparent px-1 -mx-1 rounded",
        "text-sm font-medium text-text-primary placeholder:text-text-secondary/40",
        "transition-colors hover:bg-white/[0.03] focus:bg-white/[0.04]",
        "focus:outline-none focus:ring-1 focus:ring-white/20",
        "disabled:opacity-60",
        className,
      )}
    />
  );
}

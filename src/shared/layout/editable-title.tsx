"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** Authoritative server title. Seeds the input; reverted to on cancel. */
  value: string;
  /** Fires on commit (Enter, or blur with a non-empty change). Reject to
   *  surface a server error through `onError`. */
  onSave: (next: string) => Promise<void> | void;
  /** Called when onSave throws; defaults to a console warning. Either way the
   *  input reverts to `value`. */
  onError?: (err: unknown) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Inline-editable title. Enter commits, Escape reverts, blur commits.
 * `onSave` fires only on an actual change, so empty/unchanged blurs don't
 * round-trip.
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
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
    // ⚠ Sync from prop ONLY when unfocused — otherwise a background refetch
    // clobbers the user's mid-type characters.
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
      setDraft(valueRef.current);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      setDraft(valueRef.current);
      if (onError) {
        onError(err);
      } else {
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
      className={cn(
        "min-w-0 truncate bg-transparent px-1 -mx-1 rounded",
        "text-title font-medium text-text-primary placeholder:text-text-secondary/40",
        "transition-colors hover:bg-surface-raised-1 focus:bg-surface-raised-2",
        "focus:outline-none focus:ring-1 focus:ring-border-highlight",
        "disabled:opacity-60",
        className,
      )}
    />
  );
}

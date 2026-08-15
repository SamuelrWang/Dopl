"use client";

/**
 * InlineEditableRow — autofocused inline text input. Enter/blur commits, Escape
 * cancels. CREATE flow: parent server-creates a stub, passes `selectAllOnMount`
 * + `onCancel` (deletes it). RENAME flow: omit `onCancel`.
 *
 * ⚠ IME safety (A-006): Enter / Escape are no-ops during a CJK composition, or
 * Enter selecting a Pinyin/kana candidate commits a partial transliteration.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  value: string;
  /** Trimmed value. Parent renames + clears `editing`; a throw rolls back to
   *  `value` and stays in editing mode. */
  onCommit: (next: string) => Promise<void> | void;
  /** Explicit Escape. Create flow: DELETE the stub row. Rename flow: omit. */
  onCancel?: () => Promise<void> | void;
  /** Settled with nothing to commit. Parent MUST clear `editing` — without it an
   *  unchanged blur leaves the input stuck in editing with no way out. */
  onExit?: () => void;
  /** `onCommit`/`onCancel` threw. Omitting swallows it — a failed stub delete
   *  then leaves an "Untitled" row stuck. */
  onError?: (err: unknown, action: "commit" | "cancel") => void;
  selectAllOnMount?: boolean;
  placeholder?: string;
  className?: string;
  iconBefore?: React.ReactNode;
  inputClassName?: string;
  /** ⚠ Must match the server's validator (KB names 120, entries 300, skill
   *  files 120). Native hard-cap so a 5000-char paste can't blow up the row. */
  maxLength?: number;
  ariaLabel?: string;
}

export function InlineEditableRow({
  value,
  onCommit,
  onCancel,
  onExit,
  onError,
  selectAllOnMount = false,
  placeholder,
  className,
  iconBefore,
  inputClassName,
  maxLength,
  ariaLabel,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** True once committed/cancelled — guards onBlur from a duplicate commit. */
  const settledRef = useRef(false);
  /** True while cancel runs, so onBlur doesn't commit the in-flight Escape. */
  const cancellingRef = useRef(false);
  /** ⚠ True while a commit is in flight, so a fast Enter→Escape can't fire a
   *  cancel delete racing the in-flight rename. (A-014.) */
  const committingRef = useRef(false);
  /** ⚠ IME composing (A-006) — keydown skips Enter while true. */
  const composingRef = useRef(false);

  // useLayoutEffect: focus before paint, no flash of unfocused input.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (selectAllOnMount) el.select();
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resync draft only when the parent changes `value` while we're unfocused.
  useEffect(() => {
    if (
      typeof document !== "undefined" &&
      document.activeElement !== inputRef.current
    ) {
      setDraft(value);
    }
  }, [value]);

  async function commit() {
    // Bail if settled, cancelling, or a commit is still in flight (A-014).
    if (
      settledRef.current ||
      cancellingRef.current ||
      committingRef.current
    ) {
      return;
    }
    const next = draft.trim();
    if (!next || next === value.trim()) {
      // Nothing changed — settle and exit. ⚠ NOT onCancel; that is Escape only.
      settledRef.current = true;
      onExit?.();
      return;
    }
    committingRef.current = true;
    setBusy(true);
    try {
      await onCommit(next);
      settledRef.current = true;
    } catch (err) {
      // Stay in editing; revert draft so the user can retry or escape out.
      setDraft(value);
      onError?.(err, "commit");
    } finally {
      committingRef.current = false;
      setBusy(false);
    }
  }

  async function cancel() {
    if (
      settledRef.current ||
      cancellingRef.current ||
      committingRef.current
    ) {
      return;
    }
    cancellingRef.current = true;
    try {
      if (onCancel) await onCancel();
    } catch (err) {
      // ⚠ A-004: swallowing this leaves an "Untitled" stub in the tree forever.
      onError?.(err, "cancel");
    } finally {
      settledRef.current = true;
      cancellingRef.current = false;
    }
  }

  function isImeKey(e: React.KeyboardEvent<HTMLInputElement>): boolean {
    // ⚠ Three signals, all needed: composition events, `isComposing` (modern),
    // keyCode 229 (older Safari/Chrome). Any one means the key is the IME's.
    return (
      composingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229
    );
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
        maxLength={maxLength}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (isImeKey(e)) return;
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
          // Skip if Escape just settled this.
          if (settledRef.current || cancellingRef.current) return;
          void commit();
        }}
        className={cn(
          "min-w-0 flex-1 rounded border border-border-strong bg-surface-raised-2",
          "px-1.5 py-0.5 text-small text-text-primary placeholder:text-text-muted",
          "focus:border-border-highlight focus:bg-surface-raised-3 focus:outline-none",
          "disabled:opacity-60",
          inputClassName,
        )}
      />
    </div>
  );
}

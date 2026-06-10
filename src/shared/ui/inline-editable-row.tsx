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
 *
 * IME safety (audit A-006): Enter / Escape are no-ops while a CJK
 * IME composition is in flight. Otherwise pressing Enter to select a
 * Pinyin / kana candidate would commit a partial transliteration.
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
  /**
   * Called when editing settles with nothing to commit — blur (click
   * outside) or Enter with unchanged/empty text. The parent should
   * clear its `editing` state so the row leaves edit mode; the row
   * keeps its current name. Without this, an unchanged blur left the
   * input stuck in editing with no way out.
   */
  onExit?: () => void;
  /**
   * Surface a friendly error to the user. Fires when `onCommit` throws
   * (so the parent can toast) and when `onCancel` throws (so a stub
   * delete that fails doesn't silently leave an "Untitled" row stuck).
   * If omitted, errors are swallowed by the component (the draft still
   * reverts on commit failure so editing stays usable).
   */
  onError?: (err: unknown, action: "commit" | "cancel") => void;
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
  /**
   * Server-side max length for this resource's name. Hard-cap on the
   * native input so the user can't paste a 5000-character string and
   * blow up the row layout. Match the server's validator (KB names:
   * 120, entries: 300, skill files: 120, etc.).
   */
  maxLength?: number;
  /** Optional aria-label for screen readers when there's no visual label. */
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
  /**
   * Set true once the user successfully commits OR explicitly cancels
   * — guards the onBlur handler from firing a duplicate commit when
   * we programmatically blur after a keystroke.
   */
  const settledRef = useRef(false);
  /** Set true while the cancel callback is running so onBlur doesn't
   *  also try to commit the in-flight Escape. */
  const cancellingRef = useRef(false);
  /** Set true while a commit is in flight (between setBusy(true) and
   *  the final settle) so a fast Enter→Escape can't fire a cancel
   *  delete that races the in-flight rename. (Audit A-014.) */
  const committingRef = useRef(false);
  /** Tracks whether an IME (CJK input method) is currently composing.
   *  Updated via composition events; the keydown handler skips Enter
   *  when this is true so committing a candidate selection doesn't
   *  trigger commit on a partial transliteration. (Audit A-006.) */
  const composingRef = useRef(false);

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
    // Bail if already settled, currently cancelling, or a previous
    // commit is still in flight (Audit A-014).
    if (
      settledRef.current ||
      cancellingRef.current ||
      committingRef.current
    ) {
      return;
    }
    const next = draft.trim();
    if (!next || next === value.trim()) {
      // Nothing meaningful changed — settle and tell the parent to
      // exit edit mode (the row keeps its current name). We do NOT
      // call onCancel here; that's reserved for explicit Escape.
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
      // Stay in editing mode; revert draft to the original value so the
      // user can retry or escape out, and surface the error so the
      // parent can toast.
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
      // A-004: stub delete failure was previously swallowed, leaving
      // an "Untitled" row in the tree forever. Surface it so the
      // parent can toast and the user knows the cleanup didn't land.
      onError?.(err, "cancel");
    } finally {
      settledRef.current = true;
      cancellingRef.current = false;
    }
  }

  function isImeKey(e: React.KeyboardEvent<HTMLInputElement>): boolean {
    // Modern browsers expose `isComposing` on the native event for any
    // key delivered while an IME is active. Older Safari / Chrome
    // reported keyCode 229 instead. Either signal means "this Enter is
    // for the IME, not for us." Composition events update composingRef
    // for the same purpose; check both.
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
          // Skip if Escape just settled this; commit otherwise.
          if (settledRef.current || cancellingRef.current) return;
          void commit();
        }}
        className={cn(
          "min-w-0 flex-1 rounded border border-border-strong bg-surface-raised-2",
          "px-1.5 py-0.5 text-[12px] text-text-primary placeholder:text-text-muted",
          "focus:border-border-highlight focus:bg-surface-raised-3 focus:outline-none",
          "disabled:opacity-60",
          inputClassName,
        )}
      />
    </div>
  );
}

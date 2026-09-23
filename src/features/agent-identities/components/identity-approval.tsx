"use client";

// Deep import, not the `settings-modal` barrel: that barrel reaches `next/navigation`, which breaks the SPA build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import styles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { cn } from "@/shared/lib/utils";
import { RAISED_INPUT } from "@/shared/ui/wells";

/**
 * First use of another member's identity — a security surface: their instructions run on this
 * machine as this operator, so they are shown verbatim before the first run. Main decides when this
 * appears and stores the approval machine-locally; the renderer must never cache an approval.
 */

export interface IdentityApprovalRequest {
  identityId: string;
  name: string;
  instructions: string | null;
  /** `by <member>`, the picker row's own string (it carries the preposition). */
  authorLabel?: string | null;
}

export function IdentityApprovalDialog({
  open,
  request,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** `null` keeps the shell mounted through its exit animation. */
  request: IdentityApprovalRequest | null;
  busy?: boolean;
  /** Copy for a refused `approveIdentity`, or null — never swallowed. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const heading = request ? `Run "${request.name}"?` : "Run this identity?";
  const instructions = request?.instructions?.trim() ?? "";

  return (
    <ModalShell open={open} onClose={onCancel} label={heading} size="narrow">
      <div className={styles.confirmBody}>
        <h2 className={styles.confirmTitle}>{heading}</h2>
        <p className={styles.confirmDesc}>
          {request?.authorLabel
            ? `Written ${request.authorLabel}. It runs on this Mac, as you.`
            : "Written by another member. It runs on this Mac, as you."}
        </p>

        {instructions ? (
          <div
            className={cn(
              RAISED_INPUT,
              "mb-3 max-h-[240px] overflow-y-auto whitespace-pre-wrap px-3 py-2 text-small leading-relaxed"
            )}
          >
            {instructions}
          </div>
        ) : (
          // A name-only identity is legal; say so rather than render an empty box.
          <p className="mb-3 text-caption text-text-muted">
            This identity carries no instructions.
          </p>
        )}

        {error && (
          <p role="alert" className="mb-3 text-caption text-danger">
            {error}
          </p>
        )}

        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.btnCancel}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnConfirm}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : "Run as this"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

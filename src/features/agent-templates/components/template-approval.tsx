"use client";

// ⚠ Deep import, NOT the `settings-modal` barrel — the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`, and any `next/*`
// module in the graph fails the desktop SPA build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import styles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { cn } from "@/shared/lib/utils";
import { RAISED_INPUT } from "./template-editor-rows";

/**
 * FIRST USE OF ANOTHER MEMBER'S TEMPLATE — the one modal that stands between a
 * teammate's prose and this operator's machine.
 *
 * ⚠ THIS IS A SECURITY SURFACE, NOT A COURTESY. A `team` or `workspace`
 * template's `instructions` are written by ANOTHER MEMBER and execute on YOUR
 * machine, in YOUR session, under YOUR credential, with YOUR tool profile and
 * YOUR knowledge reach. The tool profile is the only real fence and it is
 * main's; the fence stops WIDENING, not MISDIRECTION. What addresses
 * misdirection is showing a human the text before it runs — so the instructions
 * are rendered **verbatim**, never summarised, never truncated, and the confirm
 * verb says what is about to happen rather than "OK".
 *
 * ⚠ IT IS MAIN THAT DECIDES WHETHER THIS APPEARS, AND MAIN THAT REMEMBERS.
 * `sessions.launch` refuses with the wire word `template-approval`, carrying the
 * template's name and instructions; the SPA renders this, and on confirm calls
 * `sessions.approveTemplate(templateId)` and relaunches. The approval is stored
 * MACHINE-LOCALLY in the desktop's `electron-store`, beside
 * `orchestratorLaunchEnabled` and for the same reason: a server-writable
 * approval lets a credential-holding agent pre-approve itself across the fleet.
 * **Never add a remotely-addressable writer for it**, and never let this
 * component remember an answer of its own — a renderer-side "already approved"
 * cache would be exactly that fence, in the process that the untrusted text is
 * trying to influence.
 *
 * ⚠ IT IS THE `ConfirmDialog` IDIOM, not that component. `ConfirmDialog` takes a
 * `description` STRING and renders it in a compact shell; instructions run to
 * 32 KB (`../schema.ts`), so this uses the same `ModalShell` + confirm button
 * pair with the body in a bounded, scrolling raised well.
 *
 * ⚠ NO CONCAVE SURFACE — the ruling for this whole feature; swept by
 * `./template-editor.test.tsx › no concave surfaces`.
 */

export interface TemplateApprovalRequest {
  templateId: string;
  name: string;
  instructions: string | null;
  /** `by <member>`, as the picker row said it. Absent when unresolvable. */
  authorLabel?: string | null;
}

export function TemplateApprovalDialog({
  open,
  request,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** `null` keeps the shell mounted through its exit animation. */
  request: TemplateApprovalRequest | null;
  busy?: boolean;
  /** Copy for a refused `approveTemplate`, or null. ⚠ Never swallowed. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const heading = request ? `Run "${request.name}"?` : "Run this template?";
  const instructions = request?.instructions?.trim() ?? "";

  return (
    <ModalShell open={open} onClose={onCancel} label={heading} size="narrow">
      <div className={styles.confirmBody}>
        <h2 className={styles.confirmTitle}>{heading}</h2>
        {/* ⚠ THE AUTHOR IS THE POINT OF THE SENTENCE. "Another member wrote
            these instructions" is the fact the operator is being asked to accept
            — a generic "are you sure" would be chrome. */}
        <p className={styles.confirmDesc}>
          {/* ⚠ `authorLabel` ALREADY CARRIES THE PREPOSITION ("by Diana
              Taylor") — it is the picker row's own string, verbatim, so the
              modal and the row cannot word the same fact two ways. */}
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
          // ⚠ UNKNOWN IS NOT EMPTY (INVARIANTS §11), and here EMPTY IS A FACT: a
          // name-only template is a legal configuration, so say that rather than
          // rendering a blank box the operator has to interpret.
          <p className="mb-3 text-caption text-text-muted">
            This template carries no instructions.
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

// STAGING COPY of src/features/workspaces/components/request-workspace-access-dialog.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks,
// desktop libs and unstaged channel bodies → src/features/popups-staging/stubs). See src/features/popups-staging/PORTING.md.
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { apiRequest } from "@/features/settings-staging/stubs/api";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { StandardDialog, DIALOG_BTN_PRIMARY } from "@/shared/ui/standard-dialog";

const ENDPOINT = "/api/user/workspace-access-request";

export interface RequestWorkspaceAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * THE GATE ON "+ NEW WORKSPACE" (Samuel, 2026-10-15): team workspaces are
 * invite-only for now, so the rail's create tile opens THIS instead of the create
 * form. One line of copy and one centered black button; a press records the account
 * (`/api/user/workspace-access-request`, one row per user) and the button turns into
 * its requested state.
 *
 * ⚠ A MESSAGE, NOT A FORM: it collects nothing, so it is `StandardDialog`'s shell and
 * primary button rather than a `FormDialog` (docs/DESIGN-SYSTEM.md, Popup forms).
 * ⚠ THE REQUESTED STATE IS READ FROM THE SERVER on open, so a person who already
 * asked sees "Requested" rather than a button that looks like it never worked.
 */
export function RequestWorkspaceAccessDialog({
  open,
  onOpenChange,
}: RequestWorkspaceAccessDialogProps) {
  const [requested, setRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    apiRequest<{ requested: boolean }>(ENDPOINT)
      .then((res) => {
        if (!cancelled) setRequested(res.requested);
      })
      .catch(() => {
        // A failed read leaves the button pressable; the POST is idempotent.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleRequest() {
    if (requested || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ requested: boolean }>(ENDPOINT, {
        method: "POST",
      });
      setRequested(res.requested);
    } catch (err) {
      setError(userFacingMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StandardDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Team workspaces"
    >
      <p className="text-center text-lead leading-relaxed text-text-secondary">
        Team workspaces are invite-only for now. Request access and we&apos;ll let
        you know when you&apos;re in!
      </p>
      {error && <p className="text-center text-small text-danger">{error}</p>}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          className={cn(
            DIALOG_BTN_PRIMARY,
            "min-w-40",
            // The requested state is an answer, not a dead control: keep it legible.
            requested && "disabled:opacity-70"
          )}
          onClick={handleRequest}
          disabled={requested || submitting}
          aria-pressed={requested}
        >
          {requested ? "Requested" : submitting ? "Requesting..." : "Request Access"}
        </button>
      </div>
    </StandardDialog>
  );
}

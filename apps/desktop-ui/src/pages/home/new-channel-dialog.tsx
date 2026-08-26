import { useState } from "react";
import { X } from "lucide-react";
// ⚠ Deep import, NEVER the `settings-modal` barrel — the barrel re-exports
// SettingsModal, whose account pane pulls `next/navigation` into the desktop
// renderer's import graph. Same rule `create-workspace-dialog-core.tsx` states,
// and this file is modelled on it.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { errorMessage } from "#/components/page-states";
import { useCreateHomeChannel } from "./home-writes";

/** The server's own ceiling (`features/home/schema.ts › HomeChannelCreateSchema`),
 *  restated as the field's `maxLength` so the limit is felt at the keyboard
 *  rather than as a 400 after the fact. ⚠ Keep the two in step. */
const NAME_MAX = 80;

/**
 * "New channel" — the account surface's ONE creation act (Samuel, 2026-08-24).
 *
 * ⚠ ONE FIELD, AND THAT IS THE WHOLE FORM. A home channel starts SOLO: it is
 * the operator and their agents, and adding a person is a separate, later act
 * against a channel that already exists. There is nobody to invite here and no
 * second thing to name — the container takes this same name, because it is
 * plumbing nobody navigates to.
 *
 * ⚠ NO EXPLAINER PARAGRAPH, unlike the create-workspace dialog it is modelled
 * on: label + field + Create (Samuel's minimal-copy ruling). What a channel is
 * for is not a question a name field should answer.
 */
export function NewChannelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The new container's workspace id — the caller selects that row. */
  onCreated?: (workspaceId: string) => void;
}) {
  const [name, setName] = useState("");
  const create = useCreateHomeChannel((workspaceId) => {
    onOpenChange(false);
    setName("");
    onCreated?.(workspaceId);
  });

  const trimmed = name.trim();
  // ⚠ The BUTTON'S guard and the SUBMIT's guard are one expression read twice —
  // Enter reaches the same write the click does, and a disabled-looking button
  // that a keystroke can still fire is the bug this avoids.
  const canCreate = trimmed.length > 0 && !create.pending;

  const close = () => {
    onOpenChange(false);
    setName("");
  };

  const submit = () => {
    if (!canCreate) return;
    create.mutate({ name: trimmed });
  };

  return (
    <ModalShell open={open} onClose={close} label="New channel" size="narrow">
      <button
        type="button"
        className={modalStyles.close}
        onClick={close}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle}>New channel</h2>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="new-channel-name"
            className="text-label font-medium uppercase tracking-wider text-text-tertiary"
          >
            Name
          </label>
          <input
            id="new-channel-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
            maxLength={NAME_MAX}
            autoFocus
            spellCheck={false}
            className="h-9 rounded-md border border-border-strong bg-surface-raised-3 px-3 text-body text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-highlight"
          />
          {/* ⚠ A TERNARY, not `&&`: the hook types `error` as `unknown`, and
              `unknown && <jsx/>` is `unknown` — not a ReactNode. Same shape
              `add-person-popover.tsx` uses. */}
          {create.error ? (
            <p role="alert" className="text-small text-danger">
              {errorMessage(create.error)}
            </p>
          ) : null}
        </div>

        <div className={modalStyles.confirmActions}>
          <button type="button" className={modalStyles.btnCancel} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={modalStyles.btnConfirm}
            onClick={submit}
            disabled={!canCreate}
          >
            {create.pending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

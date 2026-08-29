import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import {
  DialogActions,
  DialogField,
  DIALOG_BTN_PRIMARY,
  DIALOG_BTN_SECONDARY,
  StandardDialog,
} from "@/shared/ui/standard-dialog";
import { RAISED_INPUT } from "@/shared/ui/wells";
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
 *
 * ⚠ CHROME COMES FROM `StandardDialog` (2026-08-27) — width, the centered
 * uppercase heading, the pillow field face and the fully-rounded footer pair
 * are the four /home dialogs' shared recipe, not this file's taste.
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
    <StandardDialog open={open} onClose={close} title="New channel">
      <DialogField label="Name" htmlFor="new-channel-name">
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
          className={cn(RAISED_INPUT, "h-9 px-3")}
        />
      </DialogField>

      {/* ⚠ A TERNARY, not `&&`: the hook types `error` as `unknown`, and
          `unknown && <jsx/>` is `unknown` — not a ReactNode. Same shape
          `add-person-dialog.tsx` uses. */}
      {create.error ? (
        <p role="alert" className="text-caption text-danger">
          {errorMessage(create.error)}
        </p>
      ) : null}

      <DialogActions>
        <button type="button" className={DIALOG_BTN_SECONDARY} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={DIALOG_BTN_PRIMARY}
          onClick={submit}
          disabled={!canCreate}
        >
          {create.pending ? "Creating…" : "Create"}
        </button>
      </DialogActions>
    </StandardDialog>
  );
}

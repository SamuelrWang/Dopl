import { useState } from "react";
import { FormDialog, UnderlineField } from "@/shared/ui/form-dialog";
import { errorMessage } from "#/components/page-states";
import { useCreateHomeChannel } from "./home-writes";

/** The server's own ceiling (`features/home/schema.ts › HomeChannelCreateSchema`),
 *  restated as the field's `maxLength` so the limit is felt at the keyboard
 *  rather than as a 400 after the fact. ⚠ Keep the two in step. */
const NAME_MAX = 80;

/** The DESCRIPTION's ceiling, same rule, same duty to stay in step —
 *  `features/home/schema.ts › HomeChannelCreateSchema.topic`, which is
 *  `channels/schema.ts › ChannelTopicSchema`'s 2000 restated. */
const DESCRIPTION_MAX = 2000;

/**
 * "New channel" — the account surface's ONE creation act (Samuel, 2026-08-24).
 *
 * ⚠ **IT IS THE NEW AGENT POPUP'S RECIPE, FIELD FOR FIELD (Samuel, 2026-09-15:
 * *"we need to overhaul to match it to the other pop ups UI, like the new agent
 * pop up. So it should have name, also, I want to add description as a new
 * field … match the buttons dimensions to be right according to the pop ups we
 * have elsewhere"*).** `StandardDialog` + `DialogField` + `RAISED_INPUT` +
 * `DIALOG_BTN_PRIMARY/SECONDARY` (36px pills) are GONE from this file;
 * `shared/ui/form-dialog.tsx` is the whole chrome now, so the footer is
 * `SMALL_TEXT_BUTTON` (Discard) + `PRIMARY_BTN` (`auth-btn-3d`,
 * `--action-h-sm`, `rounded-[8px]`) — the 30px scale, by construction rather
 * than by this file's taste. See docs/DESIGN-SYSTEM.md's "Popup forms".
 *
 * ⚠ **DESCRIPTION IS THE EXISTING `channels.topic` COLUMN AND NOTHING NEW
 * (ruling, 2026-09-15).** The USER-FACING word is "Description" everywhere; the
 * wire and DB field stays `topic` (2000 chars, `channels/schema.ts ›
 * ChannelTopicSchema`, already on the `Channel` DTO and already rendered by the
 * MCP `rooms list` line). **DO NOT ADD A SECOND COLUMN.** The same mismatch is
 * `new-thread-dialog.tsx`'s, stated there for `body`.
 *
 * ⚠ ONE PERSON, STILL. A home channel starts SOLO: it is the operator and their
 * agents, and adding a person is a separate, later act against a channel that
 * already exists. There is nobody to invite here, and the container takes this
 * same name because it is plumbing nobody navigates to.
 *
 * ⚠ NO EXPLAINER PARAGRAPH: label + field + Create (Samuel's minimal-copy
 * ruling). What a channel is for is now a field the operator fills in, not a
 * sentence this dialog tells them.
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
  const [description, setDescription] = useState("");
  const create = useCreateHomeChannel((workspaceId) => {
    onOpenChange(false);
    setName("");
    setDescription("");
    onCreated?.(workspaceId);
  });

  const trimmed = name.trim();
  // ⚠ The BUTTON'S guard and the SUBMIT's guard are one expression read twice —
  // Enter reaches the same write the click does, and a disabled-looking button
  // that a keystroke can still fire is the bug this avoids.
  const canCreate = trimmed.length > 0 && !create.pending;

  // ⚠ DISCARD CLEARS, it does not merely hide — the kit's rule (a dialog that
  // came back holding a draft the operator dismissed would be remembering a
  // decision they undid), and the × / backdrop / Escape are all this one exit.
  const discard = () => {
    onOpenChange(false);
    setName("");
    setDescription("");
  };

  const submit = () => {
    if (!canCreate) return;
    const topic = description.trim();
    // ⚠ OMITTED WHEN EMPTY, never sent as `""`. The field is `.optional()` on
    // `HomeChannelCreateSchema` and the service already writes `""` for a
    // channel with no description, so an empty key would be a second spelling
    // of the same absence on the wire.
    create.mutate(topic ? { name: trimmed, topic } : { name: trimmed });
  };

  return (
    <FormDialog
      open={open}
      onDiscard={discard}
      title="New channel"
      closeLabel="Close new channel form"
      primary={{
        label: create.pending ? "Creating…" : "Create",
        onClick: submit,
        disabled: !canCreate,
        busy: create.pending,
        hint: canCreate ? "Create" : "A channel needs a name",
      }}
    >
      <UnderlineField
        id="new-channel-name"
        label="Name"
        value={name}
        onChange={setName}
        ariaLabel="New channel name"
        maxLength={NAME_MAX}
        autoFocus
        // Enter reaches the same guard the button does — see `canCreate`.
        onEnter={submit}
      />
      <UnderlineField
        id="new-channel-description"
        label="Description"
        value={description}
        onChange={setDescription}
        ariaLabel="New channel description"
        maxLength={DESCRIPTION_MAX}
        // ⚠ ENTER BREAKS THE LINE HERE AND DOES NOT SUBMIT — the kit's rule for
        // every `multiline` field; `Create` is the only thing that raises the
        // channel.
        multiline
      />

      {/* ⚠ A TERNARY, not `&&`: the hook types `error` as `unknown`, and
          `unknown && <jsx/>` is `unknown` — not a ReactNode. Same shape
          `add-person-dialog.tsx` uses. */}
      {create.error ? (
        <p role="alert" className="text-caption text-danger">
          {errorMessage(create.error)}
        </p>
      ) : null}
    </FormDialog>
  );
}

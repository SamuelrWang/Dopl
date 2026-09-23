import { useState } from "react";
import { FormDialog, FormSection } from "@/shared/ui/form-dialog";
import { KnowledgeScopePicker } from "@/features/agent-identities/components/knowledge-scope-picker";
import { useAttachableBases } from "@/features/agent-identities/hooks/use-attachable-bases";
import { useIdentitySave } from "@/features/agent-identities/hooks/use-identity-save";
import { draftFromIdentity } from "@/features/agent-identities/lib/identity-draft";
import {
  EMPTY_KNOWLEDGE,
  refKey,
  scopeChipLabel,
} from "@/features/agent-identities/lib/knowledge-scopes";
import type {
  AgentIdentity,
  IdentityKnowledgeRef,
} from "@/features/agent-identities/client/types";
import { HOME_SHELF } from "./identity-editor";

/**
 * **"Add knowledge", ON THE CARD** (Samuel, 2026-09-22: *"under the description
 * of the agent and above the launch button, add a gray box that says Add
 * knowledge … the whole gray box should be clickable"*, opening *"a new popup
 * that matches the UI design of the new agent popup"* with *"selectors for
 * knowledge bases as well as specific folders/entries"*, and the picked ones
 * *"showing up as white rectangle bars within the gray box"*).
 *
 * ⚠ **IT ATTACHES TO THE IDENTITY, NOT TO ONE LAUNCH.** A card has no launch
 * form behind it (`identity-card-launch.tsx` sends the identity id and nothing
 * else), so knowledge picked here is a PATCH of the row — which is what makes it
 * true of the next launch, of the popup's launches, and of the MCP surface's.
 * A per-click attachment would be a fourth place knowledge can come from and the
 * only one nothing can read back.
 *
 * ⚠ **THE PICKER AND THE SAVE ARE THE EDITOR'S, UNFORKED** (P9-02/03):
 * `knowledge-scope-picker.tsx` (tree, prune, keyboard) with its selection drawn
 * as bars, and `use-identity-save.ts` (empty-patch skip, optimistic row, the
 * version precondition, the 412 sentence).
 *
 * ⚠ **ONE SHELF, ONE CACHE ENTRY.** The save is keyed `(homeWorkspaceId, "home")`,
 * which MUST match the shelf the PERSONAL section's read was mounted with
 * (`identity-panels.tsx › HOME_SHELF`) — a mismatch patches a key nobody is
 * subscribed to and the save silently does not appear (F-331 with the shelf as
 * the axis).
 */

/** One attachment, as a WHITE BAR — the face Samuel named, and the only thing
 *  the gray box lists. ⚠ The label is the server's own `path` falling back to
 *  the base name (`scopeChipLabel`), so a folder renamed in another window
 *  corrects itself on the next read instead of persisting here forever. */
function ScopeBar({ label }: { label: string }) {
  return (
    <span className="block w-full truncate rounded-md bg-bg-elevated px-2 py-1 text-caption text-text-secondary">
      {label}
    </span>
  );
}

/**
 * THE GRAY BOX — the whole of it is the button (his ruling), so there is no
 * inner control to miss and nothing about the bars is pressable on its own.
 *
 * ⚠ IT IS A FLAT FILL, NEVER A PRESSED-IN WELL. /home has no concave surface
 * (Samuel, 2026-08-22) and the sweep over these files enforces it
 * (`identity-editor-surface.test.tsx › no concave surfaces`).
 */
export function AddKnowledgeWell({
  refs,
  identityName,
  onClick,
}: {
  refs: ReadonlyArray<IdentityKnowledgeRef>;
  /** ⚠ **THE ACCESSIBLE NAME SAYS WHICH ROW** — one of these sits on every card
   *  in the grid, and the authoring modal's own picker is already called "Add
   *  knowledge" (`knowledge-scope-picker.tsx`, whose docblock makes exactly this
   *  argument about its own label). Several controls with one name is ambiguous
   *  on a screen reader and unaddressable for every `getByRole`. */
  identityName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add knowledge to ${identityName}`}
      className="flex w-full cursor-pointer flex-col gap-1 rounded-lg bg-bg-inset p-2 text-left transition-colors hover:bg-bg-inset-hover"
    >
      {refs.map((ref) => (
        <ScopeBar key={refKey(ref)} label={scopeChipLabel(ref)} />
      ))}
      {/* ⚠ THE WORDS STAY UNDER THE BARS RATHER THAN BEING REPLACED BY THEM:
          the box is still the way to add the next one, and a box that stopped
          saying so once it held a row would be a control that disappears the
          moment it is used. */}
      <span className="text-caption text-text-muted">Add knowledge</span>
    </button>
  );
}

/**
 * THE POPUP — the kit's form recipe (`shared/ui/form-dialog.tsx`), which IS the
 * New-agent popup's own shell, holding the checkable tree.
 *
 * ⚠ THE DIALOG STAYS OPEN UNTIL THE WRITE SETTLES AND CLOSES ONLY ON SUCCESS —
 * this tree's idiom (INVARIANTS §5A). The patch is optimistic, so a dialog that
 * closed on the click would leave a failed save with nowhere to report.
 */
export function IdentityKnowledgeDialog({
  identity,
  workspaceId,
  onClose,
}: {
  /** The row being attached to. */
  identity: AgentIdentity;
  /** The home workspace the PERSONAL list was read from, so the patch lands on
   *  the entry that list is subscribed to. */
  workspaceId: string;
  onClose: () => void;
}) {
  // ⚠ §8's STALE-CACHE FALLBACK, SPELLED INLINE at the read: `knowledge` was
  // added to an already-persisted payload.
  const [refs, setRefs] = useState<IdentityKnowledgeRef[]>(() => [
    ...(identity.knowledge ?? EMPTY_KNOWLEDGE),
  ]);
  const { save, error, saving } = useIdentitySave({
    workspaceId,
    shelf: HOME_SHELF,
    noun: "identity",
    onDone: onClose,
  });
  const attachable = useAttachableBases(workspaceId);

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title="Add knowledge"
      closeLabel="Close add knowledge"
      primary={{
        label: "Save",
        // The whole set rides the editor's own save: an unchanged set sends nothing.
        onClick: () => void save({ ...draftFromIdentity(identity), knowledge: refs }, identity),
        busy: saving,
        hint: "Save",
      }}
    >
      {/* ⚠ **"Knowledge", NOT "Knowledge bases"** (Samuel, 2026-09-08) — the
          label names what may be attached, and bases are the narrower word. */}
      <FormSection label="Knowledge">
        <KnowledgeScopePicker
          workspaceId={workspaceId}
          bases={attachable.bases}
          state={attachable.state}
          onRetry={attachable.retry}
          selected={refs}
          onChange={setRefs}
          emptyLine="No knowledge here yet."
          renderSelected={(selected) =>
            selected.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg bg-bg-inset p-2">
                {selected.map((ref) => (
                  <ScopeBar key={refKey(ref)} label={scopeChipLabel(ref)} />
                ))}
              </div>
            )
          }
        />
      </FormSection>
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

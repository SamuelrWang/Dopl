/** STAGING COPY of `apps/desktop-ui/src/pages/home/identity-card-knowledge.tsx` — verbatim; imports point at staging copies. */
import { useState } from "react";
import { Plus } from "lucide-react";
import { FormDialog, FormSection } from "@/shared/ui/form-dialog";
import { IDENTITY_ROW_ADD } from "@/features/identities-staging/agent-identities/components/identity-section";
import { KnowledgeScopePicker } from "@/features/identities-staging/agent-identities/components/knowledge-scope-picker";
import { useAttachableBases } from "@/features/identities-staging/agent-identities/hooks/use-attachable-bases";
import { useIdentitySave } from "@/features/identities-staging/agent-identities/hooks/use-identity-save";
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
 * The personal card's "Add knowledge" box and its popup. Knowledge picked here PATCHES the identity
 * (the card has no launch form), so it holds for every later launch. The picker and the save are
 * the editor's own (`knowledge-scope-picker.tsx`, `use-identity-save.ts`), unforked.
 * The save is keyed `(homeWorkspaceId, HOME_SHELF)` and must match the Personal read's shelf, or
 * the optimistic patch lands on a key nobody reads (F-331).
 */

/** One attachment as a white bar, labelled from the server's own `path` (`scopeChipLabel`), so a
 *  rename elsewhere corrects itself on the next read. */
function ScopeBar({ label }: { label: string }) {
  return (
    <span className="block w-full truncate rounded-md bg-bg-elevated px-2 py-1 text-caption text-text-secondary">
      {label}
    </span>
  );
}

/**
 * THE ADD ROW — one dashed row, the card's spec bar's twin (item 2b).
 *
 * ⚠ **IT NO LONGER LISTS THE ATTACHMENTS, AND THAT IS THE POINT.** It used to be a grey box
 * holding one white bar per attachment with the words under them, which was the heaviest thing on
 * a personal card and said what the card now says in its spec bar ("2 sources"). A control is for
 * CHANGING something; the paths themselves are an editor question. `refs` stays on the signature
 * so the accessible name can count them and the caller is unchanged.
 */
export function AddKnowledgeWell({
  refs,
  identityName,
  onClick,
}: {
  refs: ReadonlyArray<IdentityKnowledgeRef>;
  /** Names the row in the accessible name: one sits on every card, and the picker is already
   *  called "Add knowledge". */
  identityName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add knowledge to ${identityName}`}
      className={IDENTITY_ROW_ADD}
    >
      <Plus size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {refs.length === 0 ? "Add knowledge" : "Add more knowledge"}
      </span>
    </button>
  );
}

/**
 * The popup, on the kit's form recipe. `knowledge` is a replace-set (`[]` empties it); the dialog
 * closes only on success, and `expectedUpdatedAt` is the row as opened (INVARIANTS §5A, F-747).
 */
export function IdentityKnowledgeDialog({
  identity,
  workspaceId,
  onClose,
}: {
  /** The row being attached to. */
  identity: AgentIdentity;
  /** The home workspace the Personal list was read from. */
  workspaceId: string;
  onClose: () => void;
}) {
  // Stale-cache fallback: `knowledge` joined an already-persisted payload (INVARIANTS §8).
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
              // No `--bg-inset` (item 7's grey ban): the selected set is held by a hairline over
              // the near-white surface, the same face every chip and row on this page wears.
              <div className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-elevated p-2">
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

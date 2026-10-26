"use client";

import { useState } from "react";
import { FormDialog, FormSection } from "@/shared/ui/form-dialog";
import type { AgentIdentity, IdentityKnowledgeRef } from "../client/types";
import type { AttachableBases } from "../hooks/use-attachable-bases";
import { EMPTY_KNOWLEDGE, refKey, scopeChipLabel } from "../lib/knowledge-scopes";
import { KnowledgeScopePicker } from "./knowledge-scope-picker";

/**
 * The personal card's "Add knowledge" popup. `knowledge` is a replace-set (`[]` empties it); the
 * host saves it through the editor's own save, so it holds for every later launch.
 */
export function IdentityKnowledgeDialog({
  identity,
  workspaceId,
  attachable,
  saving,
  error,
  onSave,
  onClose,
}: {
  identity: AgentIdentity;
  /** The workspace the bases are read in. */
  workspaceId: string;
  attachable: AttachableBases;
  saving: boolean;
  error: string | null;
  onSave: (refs: IdentityKnowledgeRef[]) => void;
  onClose: () => void;
}) {
  // Stale-cache fallback: `knowledge` joined an already-persisted payload (INVARIANTS §8).
  const [refs, setRefs] = useState<IdentityKnowledgeRef[]>(() => [
    ...(identity.knowledge ?? EMPTY_KNOWLEDGE),
  ]);

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title="Add knowledge"
      closeLabel="Close add knowledge"
      primary={{ label: "Save", onClick: () => onSave(refs), busy: saving, hint: "Save" }}
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
              <div className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-elevated p-2">
                {selected.map((ref) => (
                  <span
                    key={refKey(ref)}
                    className="block w-full truncate rounded-md bg-bg-overlay px-2 py-1 text-caption text-text-secondary"
                  >
                    {scopeChipLabel(ref)}
                  </span>
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

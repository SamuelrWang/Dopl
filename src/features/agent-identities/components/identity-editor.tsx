"use client";

import { useMemo, useState } from "react";
import type { WorkspaceKind } from "@dopl/contracts";
import {
  FormDialog,
  FormSection,
  PillChoice,
  UnderlineField,
} from "@/shared/ui/form-dialog";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { useLaunchSelection } from "@/features/channels/hooks/use-launch-selection";
import type { AgentIdentity, IdentityVisibility } from "../client/types";
import { MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS } from "../lib/bounds";
import {
  identityModelKey,
  identityModelOptions,
  identityRuntimeOptions,
  modelAfterRuntimeChange,
} from "../lib/identity-runtime";
import {
  draftFromIdentity,
  emptyDraft,
  isDraftSavable,
  type IdentityDraft,
} from "../lib/identity-draft";
import {
  SECTIONS,
  teamScopeStranded,
  visibilityOptions,
  type IdentitySectionDef,
} from "../lib/visibility";
import {
  ChipMultiSelect,
  CustomFieldRows,
  type PickerOption,
} from "./identity-editor-rows";
import { KnowledgeScopePicker } from "./knowledge-scope-picker";
import type { AttachableBasesState } from "../hooks/use-attachable-bases";

/**
 * Create and edit in one `FormDialog` (the popup form kit); `identity === null` is create. Delete sits
 * in the body (the kit's footer is a pair) behind a confirm. Visibility options come from the section
 * array the host passes, filtered by container kind (`../lib/visibility.ts`).
 */

export interface IdentityEditorProps {
  open: boolean;
  /** The mount's container; the picker's per-base tree reads must be keyed to the same one. */
  workspaceId: string;
  /** Bumped by the caller on every open, so the draft reloads. */
  session: number;
  /** `null` = create. */
  identity: AgentIdentity | null;
  teams: ReadonlyArray<PickerOption>;
  /** The picker's roots; folders and entries are read lazily per base. */
  knowledgeBases: ReadonlyArray<PickerOption>;
  /** The base read's state (`useAttachableBases`); absent = answered. */
  knowledgeState?: AttachableBasesState;
  onKnowledgeRetry?: () => void;
  /** Which visibility scopes this mount offers, in order; defaults to `SECTIONS`. */
  sections?: ReadonlyArray<IdentitySectionDef>;
  /** The container kind written into; only `standard` offers Team. Defaults to `standard` (the Identities page). */
  containerKind?: WorkspaceKind;
  /** A new identity's visibility; a container mount must pass `"workspace"` (its only option). */
  defaultVisibility?: IdentityVisibility;
  saving: boolean;
  deleting: boolean;
  /** Server's own wording for the last failed write; `null` clears the line. */
  error: string | null;
  onClose: () => void;
  onSave: (draft: IdentityDraft) => void;
  onDelete: () => void;
}

/**
 * "N attachments aren't reachable from here" — a count from the saved row, never a name or location
 * (the same disclosure rule as the desktop's role block). Zero renders nothing.
 */
function UnreachableBasesRow({ count }: { count: number }) {
  if (count <= 0) return null;
  // "attachment", not "base": the count covers dropped folders and entries too.
  const subject =
    count === 1 ? "1 attachment" : `${count} attachments`;
  return (
    <p className="mt-1.5 text-caption text-text-muted">
      {subject} {count === 1 ? "isn't" : "aren't"} reachable from here, so{" "}
      {count === 1 ? "it isn't" : "they aren't"} listed above.
    </p>
  );
}

export function IdentityEditor({
  open,
  workspaceId,
  session,
  identity,
  teams,
  knowledgeBases,
  knowledgeState,
  onKnowledgeRetry,
  sections = SECTIONS,
  containerKind = "standard",
  defaultVisibility,
  saving,
  deleting,
  error,
  onClose,
  onSave,
  onDelete,
}: IdentityEditorProps) {
  // The draft resets from `session` during render, not in an effect (no stale frame; `session`
  // changes only on open, so the exit animation never blanks the form).
  const newDraft = () =>
    defaultVisibility
      ? { ...emptyDraft(), visibility: defaultVisibility }
      : emptyDraft();
  const [loaded, setLoaded] = useState(() => ({
    session,
    draft: identity ? draftFromIdentity(identity) : newDraft(),
  }));
  if (loaded.session !== session) {
    setLoaded({
      session,
      draft: identity ? draftFromIdentity(identity) : newDraft(),
    });
  }
  const draft = loaded.draft;
  const [confirmOpen, setConfirmOpen] = useState(false);

  function edit(patch: Partial<IdentityDraft>) {
    setLoaded((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }));
  }

  const scopes = useMemo(
    () => visibilityOptions(sections, containerKind, draft.visibility),
    [sections, containerKind, draft.visibility]
  );

  // The Model row offers the identity runtime's live models only (`../lib/identity-runtime.ts`).
  const defaults = useLaunchSelection({ kind: "defaults" });
  const { catalogFor, catalogs, runtimes } = defaults;
  const catalog = draft.runtime ? catalogFor(draft.runtime) : null;
  const runtimeOptions = useMemo(
    () => identityRuntimeOptions(runtimes, draft.runtime),
    [runtimes, draft.runtime]
  );
  const models = useMemo(
    () => identityModelOptions(draft.runtime, catalog, draft.model, catalogs),
    [draft.runtime, catalog, draft.model, catalogs]
  );
  const pickRuntime = (runtime: string) =>
    edit({
      runtime,
      model: modelAfterRuntimeChange(runtime, runtime ? catalogFor(runtime) : null, draft.model),
    });

  // A stored `team` row in a container without teams: shown, hinted, refused at Save.
  const stranded = teamScopeStranded(containerKind, draft.visibility);
  const busy = saving || deleting;
  const heading = identity ? "Edit agent identity" : "New agent identity";

  return (
    <FormDialog
      open={open}
      onDiscard={onClose}
      title={heading}
      closeLabel="Close editor"
      primary={{
        label: saving ? "Saving…" : identity ? "Save" : "Create",
        onClick: () => onSave(draft),
        disabled: !isDraftSavable(draft) || stranded,
        busy,
        // A disabled submit says why (INVARIANTS §8).
        hint: stranded ? "Team sharing needs a workspace." : undefined,
      }}
    >
      <UnderlineField
        id="agent-identity-name"
        label="Name"
        ariaLabel="Name"
        value={draft.name}
        onChange={(name) => edit({ name: name.slice(0, MAX_NAME_CHARS) })}
      />

      <UnderlineField
        id="agent-identity-description"
        label="Description"
        caption="optional"
        ariaLabel="Description"
        multiline
        value={draft.description}
        onChange={(description) =>
          edit({ description: description.slice(0, MAX_DESCRIPTION_CHARS) })
        }
      />

      <UnderlineField
        id="agent-identity-instructions"
        label="Instructions"
        caption="optional"
        ariaLabel="Instructions"
        multiline
        minRows={6}
        value={draft.instructions}
        onChange={(instructions) => edit({ instructions })}
      />

      {runtimeOptions.length > 1 && (
        <PillChoice
          label="Runtime"
          ariaLabel="Runtime"
          options={runtimeOptions}
          value={draft.runtime}
          onChange={pickRuntime}
          className="flex-wrap"
        />
      )}

      <PillChoice
        label="Model"
        ariaLabel="Model"
        options={models}
        value={identityModelKey(catalog, draft.model)}
        onChange={(model) => edit({ model })}
        className="flex-wrap"
      />

      <PillChoice
        label="Visibility"
        ariaLabel="Visibility"
        options={scopes.map((s) => ({
          key: s.visibility,
          label: s.label,
          hint: s.hint,
        }))}
        value={draft.visibility}
        onChange={(next: IdentityVisibility) =>
          // Leaving Team clears the teams (the schema refuses `teamIds` on a non-team patch).
          edit({ visibility: next, teamIds: next === "team" ? draft.teamIds : [] })
        }
        className="flex-wrap"
      />

      {draft.visibility === "team" && !stranded && (
        <FormSection label="Teams">
          <ChipMultiSelect
            options={teams}
            selectedIds={draft.teamIds}
            onChange={(teamIds) => edit({ teamIds })}
            addLabel="Add team"
            detachVerb="Remove"
            emptyLine="No teams in this workspace yet."
          />
        </FormSection>
      )}

      <FormSection label="Fields" caption="optional">
        <CustomFieldRows
          fields={draft.fields}
          onChange={(fields) => edit({ fields })}
        />
      </FormSection>

      <FormSection label="Knowledge" caption="optional">
        <KnowledgeScopePicker
          workspaceId={workspaceId}
          bases={knowledgeBases}
          selected={draft.knowledge}
          onChange={(knowledge) => edit({ knowledge })}
          emptyLine="No knowledge here yet."
          state={knowledgeState}
          onRetry={onKnowledgeRetry}
        />
        <UnreachableBasesRow count={identity?.unreachableKnowledgeBaseCount ?? 0} />
      </FormSection>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      {identity && (
        // Ink, no button face (Samuel's ruling); the confirm is the gate.
        <div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="flex h-[var(--action-h-sm)] items-center rounded-[8px] px-2.5 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={identity ? `Delete "${identity.name}"?` : "Delete identity?"}
        description="This permanently deletes the agent identity. It can't be undone."
        confirmLabel="Delete identity"
        destructive
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete();
        }}
      />
    </FormDialog>
  );
}

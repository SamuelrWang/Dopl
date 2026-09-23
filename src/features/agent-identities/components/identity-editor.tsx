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
 * CREATE AND EDIT, in ONE surface — and since 2026-09-08 it is a
 * `shared/ui/form-dialog.tsx › FormDialog`, the POPUP FORM KIT, because Samuel
 * ruled every input dialog onto it: *"apply the UI styling to the Edit
 * identity/new agent identity pop up."*
 *
 * ⚠ **WHAT THE KIT REPLACED, ITEM FOR ITEM.** The uppercase field headers over
 * `RAISED_INPUT` "pillow" boxes are the bold label over an UNDERLINE
 * ({@link UnderlineField}); the Visibility `SegmentedControl` and the Model
 * `SelectMenu` are both {@link PillChoice} — one 30px `plain`/`md` row apiece —
 * and the footer is the kit's Discard + verb at `--action-h-sm`. The recipe is
 * stated ONCE in the kit and in `docs/DESIGN-SYSTEM.md` › Popup forms; nothing
 * about it is restated here.
 * ⚠ **THE 2026-08-27 NOTE THAT THIS FILE WAS THE REFERENCE THE /home DIALOGS
 * STANDARDISED ONTO IS SUPERSEDED, NOT DELETED.** `RAISED_INPUT` is still the
 * face of every control that is NOT a popup form field — including this
 * dialog's own inline key/value rows (`./identity-editor-rows.tsx`), which are
 * a repeating LIST and have no `FormSection` of their own.
 *
 * ⚠ **THE PAYLOAD DID NOT MOVE, AND THAT IS PINNED RATHER THAN ASSERTED.**
 * `identity-editor.test.tsx › the payload survives the face` was written and
 * green against the PRE-KIT editor, so its literals are a snapshot of what the
 * old markup sent. A face change that reaches `draftToCreateBody` /
 * `draftToPatchBody` fails there.
 *
 * ⚠ ONE COMPONENT FOR BOTH MODES. `identity === null` is create; anything else
 * is edit, and the ONLY differences are the heading, the Save verb, and whether
 * Delete exists.
 *
 * ⚠ **DELETE MOVED INTO THE BODY, because the kit's footer is a PAIR.**
 * `FormDialog` owns Discard + the verb and takes no third slot — one exit, one
 * act. Delete is still ink with no button face (Samuel's older ruling) and
 * still behind the confirm; what changed is which row it sits on.
 *
 * ⚠ NO LAUNCH CONTROL. Choosing an identity AT LAUNCH is a later phase; this is
 * where identities are authored and nothing else.
 *
 * ⚠ THE VISIBILITY CONTROL IS DERIVED FROM A SECTION ARRAY THE CALLER NAMES —
 * **and, since 2026-09-08, from the CONTAINER KIND as well** ({@link
 * IdentityEditorProps.containerKind}). The labels still come from
 * `../lib/visibility.ts`, never from a literal here.
 */

export interface IdentityEditorProps {
  open: boolean;
  /** ⚠ THE MOUNT'S CONTAINER, threaded to the knowledge picker's per-base tree
   *  reads. The base OPTIONS already came from a read keyed to it; the tree
   *  reads must be keyed to the same one or the picker would expand a base in
   *  one container against another's tenancy. */
  workspaceId: string;
  /** Bumped by the caller on every open, so the draft reloads. */
  session: number;
  /** `null` = create. */
  identity: AgentIdentity | null;
  teams: ReadonlyArray<PickerOption>;
  /** ⚠ THE BASES ONLY — the ROOTS of the picker's tree. Folders and entries are
   *  read lazily per base by the picker itself. */
  knowledgeBases: ReadonlyArray<PickerOption>;
  /** The base read's state (`useAttachableBases`); absent = answered. */
  knowledgeState?: AttachableBasesState;
  onKnowledgeRetry?: () => void;
  /**
   * Which visibility scopes this mount offers, IN ORDER. Defaults to the
   * workspace page's three (`SECTIONS`); the /home Agents face's container mount
   * passes `SECTIONS_CONTAINER`, which is one.
   */
  sections?: ReadonlyArray<IdentitySectionDef>;
  /**
   * 🔒 **WHICH KIND OF CONTAINER THIS MOUNT WRITES INTO — Samuel's ruling,
   * 2026-09-08: *"we should remove the team option, if it's in the home space,
   * because the team thing is for workspaces."*** `personal` (the /home
   * Personal shelf) and `link` (a home channel) hold no team rows, so the Team
   * pill is not offered there — `../lib/visibility.ts › visibilityOptions` is
   * the rule and `server/service-write-gates.ts › assertTeamScopeGrantable` is
   * the fence.
   *
   * ⚠ **DEFAULTS TO `standard`, WHICH IS THE WORKSPACE AGENTS PAGE.** That page
   * is reachable only for a standard workspace (`workspaces/types.ts ›
   * isStandardWorkspace` keeps every other kind off the rail), so the default is
   * a fact about the route rather than an optimistic guess.
   */
  containerKind?: WorkspaceKind;
  /**
   * What a NEW identity starts as. Defaults to `emptyDraft()`'s `'private'`,
   * which is right on a workspace page. ⚠ A CONTAINER mount must pass
   * `"workspace"`: `SECTIONS_CONTAINER` offers that value alone since
   * 2026-08-27, and a draft opening on a visibility the control cannot show is
   * a form whose selected option is invisible — and whose save would create a
   * row no surface lists (`../lib/visibility.ts`).
   */
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
 * "SOME OF THIS ROLE'S KNOWLEDGE IS NOT HERE" — a COUNT, under the chips
 * (ruled 2026-09-06 under Samuel's delegation; the launch payload's own
 * discipline, one surface earlier).
 *
 * 🔒 **A NUMBER IS THE WHOLE DISCLOSURE.** The id, the name, the workspace and
 * the container of a base this caller cannot see are exactly what
 * `service-knowledge-decoration.ts › decorateWithKnowledgeBases` withholds, so
 * none of them may be written here and none may be inferred out loud — the same
 * rule the desktop's ROLE block keeps in
 * `prompt-framing-agent-identity.js › unreachableKnowledgeLines`. What the operator
 * learns is a fact about THEIR OWN view: this role names something this view
 * cannot resolve.
 *
 * ⚠ **NO SECOND READ AND NO PROBE.** The count rides in on the identity row the
 * editor was already handed (`types.ts › AgentIdentity`), which is arithmetic
 * the list read did over junction rows it had already fetched.
 *
 * ⚠ **IT DESCRIBES THE SAVED ROW, NEVER THE DRAFT**, and it cannot go stale
 * against the chips above it: an unreachable link is absent from
 * `draft.knowledge` by construction.
 *
 * ⚠ **NOTHING IS BLOCKED AND NOTHING IS OFFERED.** There is no fix-it control
 * here on purpose — the operator cannot be shown the base to detach it.
 *
 * ⚠ ZERO RENDERS NOTHING. "0 bases unreachable" is a line every well-formed
 * identity would carry forever (INVARIANTS §5: labels, not explainers).
 */
function UnreachableBasesRow({ count }: { count: number }) {
  if (count <= 0) return null;
  // ⚠ **"attachment", NOT "base", SINCE 2026-09-08.** The count covers a dropped
  // FOLDER and a dropped ENTRY too — a trashed entry is exactly as unreportable
  // as a private base — and calling one of those "a base" would be a wrong
  // sentence about what the role names.
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
  // ⚠ DRAFT RESET IS DERIVED FROM `session` DURING RENDER, not from an effect —
  // an effect paints one frame of the PREVIOUS identity's values into the new
  // modal, and set-state in an effect body is the cascading render the lint rule
  // forbids. `session` changes only on open, so a close (which plays an exit
  // animation with this component still mounted) never blanks the form mid-fade.
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

  // The Runtime row offers the desktop's registered runtimes; the Model row offers THAT
  // runtime's live models ("Default" first — the draft's own "no model"). No runtime, or no
  // catalog for it, is "Default" plus the stored value as itself (F11, P7-12, X-03).
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

  // 🔒 A STORED `team` ROW INSIDE A CONTAINER THAT HAS NO TEAMS. Shown, hinted,
  // and refused at Save — never rewritten on the operator's behalf.
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
        // ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4) — one short line.
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
          // ⚠ Leaving the Team scope CLEARS the teams. A stale grant behind
          // a `private` label is sharing nobody asked for — and the schema
          // REFUSES a `teamIds` key on a non-team patch, so carrying them
          // would also be a 400 on the next unrelated edit.
          edit({ visibility: next, teamIds: next === "team" ? draft.teamIds : [] })
        }
        className="flex-wrap"
      />

      {/* ⚠ THE PICKER FOLLOWS THE LIVE SCOPE, NOT THE STORED ONE. A stranded
          `team` row has no teams to offer — the container holds none — so the
          control that would ask for one is absent and the hint on its pill is
          the whole of what the surface says. */}
      {draft.visibility === "team" && !stranded && (
        <FormSection label="Teams">
          {/* ⚠ MULTI-SELECT, because the server's `teamIds` is a set. */}
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

      {/* ⚠ **"Knowledge", NOT "Knowledge bases" (Samuel, 2026-09-08: *"rename
          knowledge bases to knowledge"*).** The label names what may be
          attached, and since this wave that is a base, a folder OR an entry —
          "bases" was the narrower of the two words and is now the wrong one. */}
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
        // ⚠ NO BUTTON FACE. Delete is the one verb here that must not look as
        // pressable as the pair in the footer; it is ink and a soft hover, and
        // the confirm below is the real gate.
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

      {/* ⚠ HARD DELETE, and the copy says so — the row is gone, not archived. */}
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

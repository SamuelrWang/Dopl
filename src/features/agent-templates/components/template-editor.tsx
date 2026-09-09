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
import { agentModelLabel, agentModelOptionsFor } from "@/features/channels/lib/agent-models";
import type { AgentTemplate, TemplateVisibility } from "../client/types";
import {
  draftFromTemplate,
  emptyDraft,
  isDraftSavable,
  type TemplateDraft,
} from "../lib/template-draft";
import {
  SECTIONS,
  teamScopeStranded,
  visibilityOptions,
  type TemplateSectionDef,
} from "../lib/visibility";
import {
  ChipMultiSelect,
  CustomFieldRows,
  type PickerOption,
} from "./template-editor-rows";

/**
 * CREATE AND EDIT, in ONE surface — and since 2026-09-08 it is a
 * `shared/ui/form-dialog.tsx › FormDialog`, the POPUP FORM KIT, because Samuel
 * ruled every input dialog onto it: *"apply the UI styling to the Edit
 * template/new agent template pop up."*
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
 * dialog's own inline key/value rows (`./template-editor-rows.tsx`), which are
 * a repeating LIST and have no `FormSection` of their own.
 *
 * ⚠ **THE PAYLOAD DID NOT MOVE, AND THAT IS PINNED RATHER THAN ASSERTED.**
 * `template-editor.test.tsx › the payload survives the face` was written and
 * green against the PRE-KIT editor, so its literals are a snapshot of what the
 * old markup sent. A face change that reaches `draftToCreateBody` /
 * `draftToPatchBody` fails there.
 *
 * ⚠ ONE COMPONENT FOR BOTH MODES. `template === null` is create; anything else
 * is edit, and the ONLY differences are the heading, the Save verb, and whether
 * Delete exists.
 *
 * ⚠ **DELETE MOVED INTO THE BODY, because the kit's footer is a PAIR.**
 * `FormDialog` owns Discard + the verb and takes no third slot — one exit, one
 * act. Delete is still ink with no button face (Samuel's older ruling) and
 * still behind the confirm; what changed is which row it sits on.
 *
 * ⚠ NO LAUNCH CONTROL. Choosing a template AT LAUNCH is a later phase; this is
 * where templates are authored and nothing else.
 *
 * ⚠ THE VISIBILITY CONTROL IS DERIVED FROM A SECTION ARRAY THE CALLER NAMES —
 * **and, since 2026-09-08, from the CONTAINER KIND as well** ({@link
 * TemplateEditorProps.containerKind}). The labels still come from
 * `../lib/visibility.ts`, never from a literal here.
 */

export interface TemplateEditorProps {
  open: boolean;
  /** Bumped by the caller on every open, so the draft reloads. */
  session: number;
  /** `null` = create. */
  template: AgentTemplate | null;
  teams: ReadonlyArray<PickerOption>;
  knowledgeBases: ReadonlyArray<PickerOption>;
  /**
   * Which visibility scopes this mount offers, IN ORDER. Defaults to the
   * workspace page's three (`SECTIONS`); the /home Agents face's container mount
   * passes `SECTIONS_CONTAINER`, which is one.
   */
  sections?: ReadonlyArray<TemplateSectionDef>;
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
   * What a NEW template starts as. Defaults to `emptyDraft()`'s `'private'`,
   * which is right on a workspace page. ⚠ A CONTAINER mount must pass
   * `"workspace"`: `SECTIONS_CONTAINER` offers that value alone since
   * 2026-08-27, and a draft opening on a visibility the control cannot show is
   * a form whose selected option is invisible — and whose save would create a
   * row no surface lists (`../lib/visibility.ts`).
   */
  defaultVisibility?: TemplateVisibility;
  saving: boolean;
  deleting: boolean;
  /** Server's own wording for the last failed write; `null` clears the line. */
  error: string | null;
  onClose: () => void;
  onSave: (draft: TemplateDraft) => void;
  onDelete: () => void;
}

/** ⚠ THE SCHEMA'S OWN BOUNDS (`../schema.ts`), CLAMPED IN THE HANDLER because
 *  the kit's field takes no `maxLength` — same effect, one keystroke later:
 *  the value can never exceed the cap, so no save can 400 on length. */
const MAX_NAME = 120;
const MAX_DESCRIPTION = 280;

/** The blank model — `""` on the wire, "Default" in front of an operator. */
const NO_MODEL = "";

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
 * `prompt-framing-template.js › unreachableKnowledgeLines`. What the operator
 * learns is a fact about THEIR OWN view: this role names something this view
 * cannot resolve.
 *
 * ⚠ **NO SECOND READ AND NO PROBE.** The count rides in on the template row the
 * editor was already handed (`types.ts › AgentTemplate`), which is arithmetic
 * the list read did over junction rows it had already fetched.
 *
 * ⚠ **IT DESCRIBES THE SAVED ROW, NEVER THE DRAFT**, and it cannot go stale
 * against the chips above it: an unreachable link is absent from
 * `draft.knowledgeBaseIds` by construction.
 *
 * ⚠ **NOTHING IS BLOCKED AND NOTHING IS OFFERED.** There is no fix-it control
 * here on purpose — the operator cannot be shown the base to detach it.
 *
 * ⚠ ZERO RENDERS NOTHING. "0 bases unreachable" is a line every well-formed
 * template would carry forever (INVARIANTS §5: labels, not explainers).
 */
function UnreachableBasesRow({ count }: { count: number }) {
  if (count <= 0) return null;
  const subject = count === 1 ? "1 attached base" : `${count} attached bases`;
  return (
    <p className="mt-1.5 text-caption text-text-muted">
      {subject} {count === 1 ? "isn't" : "aren't"} reachable from here, so{" "}
      {count === 1 ? "it isn't" : "they aren't"} listed above.
    </p>
  );
}

export function TemplateEditor({
  open,
  session,
  template,
  teams,
  knowledgeBases,
  sections = SECTIONS,
  containerKind = "standard",
  defaultVisibility,
  saving,
  deleting,
  error,
  onClose,
  onSave,
  onDelete,
}: TemplateEditorProps) {
  // ⚠ DRAFT RESET IS DERIVED FROM `session` DURING RENDER, not from an effect —
  // an effect paints one frame of the PREVIOUS template's values into the new
  // modal, and set-state in an effect body is the cascading render the lint rule
  // forbids. `session` changes only on open, so a close (which plays an exit
  // animation with this component still mounted) never blanks the form mid-fade.
  const newDraft = () =>
    defaultVisibility
      ? { ...emptyDraft(), visibility: defaultVisibility }
      : emptyDraft();
  const [loaded, setLoaded] = useState(() => ({
    session,
    draft: template ? draftFromTemplate(template) : newDraft(),
  }));
  if (loaded.session !== session) {
    setLoaded({
      session,
      draft: template ? draftFromTemplate(template) : newDraft(),
    });
  }
  const draft = loaded.draft;
  const [confirmOpen, setConfirmOpen] = useState(false);

  function edit(patch: Partial<TemplateDraft>) {
    setLoaded((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }));
  }

  const scopes = useMemo(
    () => visibilityOptions(sections, containerKind, draft.visibility),
    [sections, containerKind, draft.visibility]
  );

  /**
   * ⚠ **"Default" IS PREPENDED, AND IT IS THE DRAFT'S OWN VALUE RATHER THAN A
   * NEW PICK.** `TemplateDraft.model` has always spelled "this template pins no
   * model" as `""` (the create body OMITS the key, the patch sends `null`), and
   * `AGENT_MODEL_OPTIONS` stopped carrying that state on 2026-09-06 — so the
   * retired `SelectMenu` rendered BLANK on every new template and could never be
   * put back once a model was chosen. A pill row needs one option selected, and
   * the honest one is the value the draft is actually holding (INVARIANTS §11 —
   * a back-filled "Sonnet" here would claim a pin the row does not have).
   * ⚠ `agentModelOptionsFor`, not the bare roster: a stored id this build does
   * not know is APPENDED rather than dropped, so an older template keeps its
   * selection instead of showing none.
   */
  const models = useMemo(
    () => [
      { key: NO_MODEL, label: agentModelLabel(NO_MODEL) },
      ...agentModelOptionsFor(draft.model).map((o) => ({
        key: o.value,
        label: o.label,
      })),
    ],
    [draft.model]
  );

  // 🔒 A STORED `team` ROW INSIDE A CONTAINER THAT HAS NO TEAMS. Shown, hinted,
  // and refused at Save — never rewritten on the operator's behalf.
  const stranded = teamScopeStranded(containerKind, draft.visibility);
  const busy = saving || deleting;
  const heading = template ? "Edit template" : "New template";

  return (
    <FormDialog
      open={open}
      onDiscard={onClose}
      title={heading}
      closeLabel="Close editor"
      primary={{
        label: saving ? "Saving…" : template ? "Save" : "Create",
        onClick: () => onSave(draft),
        disabled: !isDraftSavable(draft) || stranded,
        busy,
        // ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4) — one short line.
        hint: stranded ? "Team sharing needs a workspace." : undefined,
      }}
    >
      <UnderlineField
        id="agent-template-name"
        label="Name"
        ariaLabel="Name"
        value={draft.name}
        onChange={(name) => edit({ name: name.slice(0, MAX_NAME) })}
      />

      <UnderlineField
        id="agent-template-description"
        label="Description"
        caption="optional"
        ariaLabel="Description"
        multiline
        value={draft.description}
        onChange={(description) =>
          edit({ description: description.slice(0, MAX_DESCRIPTION) })
        }
      />

      <UnderlineField
        id="agent-template-instructions"
        label="Instructions"
        caption="optional"
        ariaLabel="Instructions"
        multiline
          minRows={6}
        value={draft.instructions}
        onChange={(instructions) => edit({ instructions })}
      />

      <PillChoice
        label="Model"
        ariaLabel="Model"
        options={models}
        value={draft.model}
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
        onChange={(next: TemplateVisibility) =>
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

      <FormSection label="Knowledge bases" caption="optional">
        <ChipMultiSelect
          options={knowledgeBases}
          selectedIds={draft.knowledgeBaseIds}
          onChange={(knowledgeBaseIds) => edit({ knowledgeBaseIds })}
          addLabel="Attach"
          detachVerb="Detach"
          emptyLine="No knowledge bases yet."
        />
        <UnreachableBasesRow count={template?.unreachableKnowledgeBaseCount ?? 0} />
      </FormSection>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      {template && (
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
        title={template ? `Delete "${template.name}"?` : "Delete template?"}
        description="This permanently deletes the template. It can't be undone."
        confirmLabel="Delete template"
        destructive
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete();
        }}
      />
    </FormDialog>
  );
}

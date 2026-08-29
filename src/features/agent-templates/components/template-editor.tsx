"use client";

import { useMemo, useState } from "react";
import {
  DialogActions,
  DIALOG_BTN_PRIMARY,
  DIALOG_BTN_SECONDARY,
  StandardDialog,
} from "@/shared/ui/standard-dialog";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { cn } from "@/shared/lib/utils";
import { agentModelOptionsFor } from "@/features/channels/lib/agent-models";
import type { AgentTemplate, TemplateVisibility } from "../client/types";
import {
  draftFromTemplate,
  emptyDraft,
  isDraftSavable,
  type TemplateDraft,
} from "../lib/template-draft";
import { SECTIONS, type TemplateSectionDef } from "../lib/visibility";
import {
  ChipMultiSelect,
  CustomFieldRows,
  Field,
  RAISED_INPUT,
  type PickerOption,
} from "./template-editor-rows";

/**
 * CREATE AND EDIT, in ONE surface — a `StandardDialog`, which is THIS repo's
 * entity-editing idiom (`knowledge/components/base-settings-modal.tsx`,
 * `channels/components/create-channel-dialog.tsx`, every create dialog in the
 * tree). No slide-over precedent exists here, and inventing one would make this
 * the only page whose editor arrives from the side.
 *
 * ⚠ THIS WAS THE REFERENCE Samuel standardised the /home dialogs onto
 * (2026-08-27) — its width, its pillow inputs and its uppercase field headers
 * became `shared/ui/standard-dialog.tsx` + `shared/ui/wells.ts › RAISED_INPUT`,
 * and this file now composes them rather than stating them. What CHANGED here
 * in that pass: the heading is centered and uppercased, and both footer buttons
 * are fully rounded.
 *
 * ⚠ ONE COMPONENT FOR BOTH MODES. `template === null` is create; anything else
 * is edit, and the ONLY differences are the heading, the Save verb, and whether
 * Delete exists. A separate create dialog would be a second statement of the
 * same six fields, and the field list is exactly what a template IS.
 *
 * ⚠ NO CONCAVE SURFACE ANYWHERE (Samuel, 2026-08-22) — see
 * `./template-editor-rows.tsx`. The Visibility control is the kit's
 * `SegmentedControl`, which is TRACKLESS: flat `.seg-pill` options with a
 * `.raised-tab` active face, no `.concave-track` under it.
 *
 * ⚠ NO LAUNCH CONTROL. Choosing a template AT LAUNCH is a later phase; this page
 * is where templates are authored and nothing else.
 *
 * ⚠ THE VISIBILITY CONTROL IS DERIVED FROM A SECTION ARRAY THE CALLER NAMES, and
 * inside a link CONTAINER that array has TWO entries (2026-08-26,
 * `docs/specs/home-agents-tab.plan.md` §4.5). A container has no teams (§4A), so
 * `team` there is a scope that can never resolve to anybody — offering it would
 * be this editor inviting a grant nothing could hold. **The labels still come
 * from `../lib/visibility.ts`, never from a literal here**: the container's
 * shared scope reads "Shared in this channel", never "Public", and two arrays in
 * one module cannot drift the way two components hand-typing headings can.
 * ⚠ THE TEAM-CLEARING BRANCH BELOW STAYS EITHER WAY — it guards the WORKSPACE
 * page, where `team` is live, and a container mount simply never reaches it.
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
   * passes `SECTIONS_CONTAINER`, which is two.
   */
  sections?: ReadonlyArray<TemplateSectionDef>;
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

export function TemplateEditor({
  open,
  session,
  template,
  teams,
  knowledgeBases,
  sections = SECTIONS,
  defaultVisibility,
  saving,
  deleting,
  error,
  onClose,
  onSave,
  onDelete,
}: TemplateEditorProps) {
  const visibilityOptions = useMemo(
    () => sections.map((s) => ({ key: s.visibility, label: s.label })),
    [sections]
  );
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

  const busy = saving || deleting;
  const heading = template ? "Edit template" : "New template";

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={heading}
      closeLabel="Close editor"
    >
      <Field label="Name" htmlFor="agent-template-name">
        <input
          id="agent-template-name"
          value={draft.name}
          onChange={(e) => edit({ name: e.target.value })}
          maxLength={120}
          autoFocus
          placeholder="e.g. Release captain"
          className={cn(RAISED_INPUT, "h-9 px-3")}
        />
      </Field>

      <Field
        label="Description"
        hint="(optional)"
        htmlFor="agent-template-description"
      >
        <input
          id="agent-template-description"
          value={draft.description}
          onChange={(e) => edit({ description: e.target.value })}
          maxLength={280}
          placeholder="What this agent is for"
          className={cn(RAISED_INPUT, "h-9 px-3")}
        />
      </Field>

      <Field label="Visibility">
        <SegmentedControl
          options={visibilityOptions}
          value={draft.visibility}
          onChange={(next: TemplateVisibility) =>
            // ⚠ Leaving the Team scope CLEARS the teams. A stale grant behind
            // a `private` label is sharing nobody asked for — and the schema
            // REFUSES a `teamIds` key on a non-team patch, so carrying them
            // would also be a 400 on the next unrelated edit.
            edit({ visibility: next, teamIds: next === "team" ? draft.teamIds : [] })
          }
          disabled={busy}
        />
      </Field>

      {draft.visibility === "team" && (
        <Field label="Teams">
          {/* ⚠ MULTI-SELECT, because the server's `teamIds` is a set. */}
          <ChipMultiSelect
            options={teams}
            selectedIds={draft.teamIds}
            onChange={(teamIds) => edit({ teamIds })}
            addLabel="Add team"
            detachVerb="Remove"
            emptyLine="No teams in this workspace yet."
          />
        </Field>
      )}

      <Field label="Model">
        {/* ⚠ `agentModelOptionsFor` appends a stored id this build does not
              know rather than dropping it — a SelectMenu whose value matches no
              option renders BLANK, which is the surface saying nothing where it
              has an answer (INVARIANTS §5). */}
        {/* ⚠ THE RAISED FACE — every dropdown inside a standard dialog wears
              it (Samuel, 2026-08-27), so the picker reads as a control of the
              same family as the fields above it rather than as inset chrome. */}
        <SelectMenu
          value={draft.model}
          options={agentModelOptionsFor(draft.model)}
          onChange={(model) => edit({ model })}
          ariaLabel="Model"
          disabled={busy}
          variant="raised"
          className="w-fit"
        />
      </Field>

      <Field
        label="Instructions"
        hint="(optional)"
        htmlFor="agent-template-instructions"
      >
        <textarea
          id="agent-template-instructions"
          value={draft.instructions}
          onChange={(e) => edit({ instructions: e.target.value })}
          rows={10}
          placeholder="How this agent should work"
          className={cn(RAISED_INPUT, "min-h-[220px] resize-y px-3 py-2 leading-relaxed")}
        />
      </Field>

      <Field label="Fields" hint="(optional)">
        <CustomFieldRows
          fields={draft.fields}
          onChange={(fields) => edit({ fields })}
        />
      </Field>

      <Field label="Knowledge bases" hint="(optional)">
        <ChipMultiSelect
          options={knowledgeBases}
          selectedIds={draft.knowledgeBaseIds}
          onChange={(knowledgeBaseIds) => edit({ knowledgeBaseIds })}
          addLabel="Attach"
          detachVerb="Detach"
          emptyLine="No knowledge bases yet."
        />
      </Field>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      <DialogActions
        leading={
          template && (
            // ⚠ NO BUTTON FACE. Delete is the one verb here that must not
            // look as pressable as the two beside it; it is ink and a soft
            // hover, and the confirm below is the real gate.
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              className="h-10 rounded-full px-3 text-body font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )
        }
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className={DIALOG_BTN_SECONDARY}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={busy || !isDraftSavable(draft)}
          className={DIALOG_BTN_PRIMARY}
        >
          {saving ? "Saving…" : template ? "Save" : "Create template"}
        </button>
      </DialogActions>

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
    </StandardDialog>
  );
}

"use client";

import { useState } from "react";
import { X } from "lucide-react";
// ⚠ Deep import, NOT the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`, and any `next/*`
// module in the graph fails the desktop SPA build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
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
import { SECTIONS } from "../lib/visibility";
import {
  ChipMultiSelect,
  CustomFieldRows,
  Field,
  RAISED_INPUT,
  type PickerOption,
} from "./template-editor-rows";

/**
 * CREATE AND EDIT, in ONE surface — a narrow `ModalShell`, which is THIS repo's
 * entity-editing idiom (`knowledge/components/base-settings-modal.tsx`,
 * `channels/components/create-channel-dialog.tsx`, every create dialog in the
 * tree). No slide-over precedent exists here, and inventing one would make this
 * the only page whose editor arrives from the side.
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
 */

const VISIBILITY_OPTIONS = SECTIONS.map((s) => ({
  key: s.visibility,
  label: s.label,
}));

export interface TemplateEditorProps {
  open: boolean;
  /** Bumped by the caller on every open, so the draft reloads. */
  session: number;
  /** `null` = create. */
  template: AgentTemplate | null;
  teams: ReadonlyArray<PickerOption>;
  knowledgeBases: ReadonlyArray<PickerOption>;
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
  const [loaded, setLoaded] = useState(() => ({
    session,
    draft: template ? draftFromTemplate(template) : emptyDraft(),
  }));
  if (loaded.session !== session) {
    setLoaded({
      session,
      draft: template ? draftFromTemplate(template) : emptyDraft(),
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
    <ModalShell open={open} onClose={onClose} label={heading} size="narrow">
      <button
        type="button"
        className={modalStyles.close}
        onClick={onClose}
        aria-label="Close editor"
      >
        <X size={18} />
      </button>

      <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto p-6">
        <h2 className="text-title font-semibold text-text-primary">{heading}</h2>

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

        <Field label="Description" hint="(optional)" htmlFor="agent-template-description">
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
            options={VISIBILITY_OPTIONS}
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
          <SelectMenu
            value={draft.model}
            options={agentModelOptionsFor(draft.model)}
            onChange={(model) => edit({ model })}
            ariaLabel="Model"
            disabled={busy}
            className="w-fit"
          />
        </Field>

        <Field label="Instructions" hint="(optional)" htmlFor="agent-template-instructions">
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
          <CustomFieldRows fields={draft.fields} onChange={(fields) => edit({ fields })} />
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

        <div className="flex items-center gap-2 pt-1">
          {template && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              className="h-10 rounded-[9px] px-3 text-body font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="auth-btn-3d-light h-10 rounded-[9px] px-4 text-body font-medium text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={busy || !isDraftSavable(draft)}
            className="auth-btn-3d h-10 rounded-[9px] px-4 text-body font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : template ? "Save" : "Create template"}
          </button>
        </div>
      </div>

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
    </ModalShell>
  );
}

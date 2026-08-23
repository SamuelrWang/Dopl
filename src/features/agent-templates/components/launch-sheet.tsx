"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
// ⚠ Deep import, NOT the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`, and any `next/*`
// module in the graph fails the desktop SPA build (`./template-editor.tsx`
// carries the same note and the same import).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { SelectMenu } from "@/shared/ui/select-menu";
import { cn } from "@/shared/lib/utils";
import {
  AGENT_MODEL_DEFAULT,
  agentModelOptionsFor,
} from "@/features/channels/lib/agent-models";
import type { AgentTemplate, TemplateField } from "../client/types";
import {
  MAX_OVERRIDE_KEY_CHARS,
  MAX_OVERRIDE_VALUE_CHARS,
  overridesFor,
  type TemplateLaunchOverrides,
} from "../lib/launch-overrides";
import { Field, RAISED_INPUT } from "./template-editor-rows";

/**
 * THE LAUNCH SHEET — one template, about to run, with the two things a launch is
 * allowed to re-point.
 *
 * ⚠ IT IS NOT ON THE ONE-CLICK PATH AND MUST NEVER MOVE ONTO IT (Samuel's
 * standing channels-v2 ruling: *one lane, one-click launch*). Clicking the
 * template ROW in the picker launches immediately with the template's own
 * defaults; this sheet opens from that row's CHEVRON, which is a second,
 * deliberate act. `../lib/launch-overrides.ts › overridesFor` guarantees the two
 * paths converge: an untouched sheet sends the same payload the row click sends.
 *
 * ⚠ MODEL AND FIELDS ARE EDITABLE; INSTRUCTIONS ARE NOT. An editable
 * instructions box at launch is a SECOND AUTHORING SURFACE for the durable
 * thing, and the durable thing has an editor already — so instructions are shown
 * verbatim, read-only, collapsed, and the operator can expand them to read what
 * they are about to run. That is also the security reading: on a foreign
 * template this is the same text the first-use approval modal shows.
 *
 * ⚠ NOTHING HERE WRITES BACK. The sheet says so in exactly one quiet line
 * (INVARIANTS §5, minimal copy) rather than explaining itself per field.
 *
 * ⚠ NO CONCAVE SURFACE (Samuel, 2026-08-22, the ruling for this whole feature).
 * Every input wears `RAISED_INPUT`; `./template-editor.test.tsx › no concave
 * surfaces` sweeps this file's source and fails on the pressed-in class names.
 */

/** The sheet's own working copy. Discarded on close — see the module header. */
interface SheetDraft {
  /** `""` = the template's own default, which is what the first option says. */
  model: string;
  fields: TemplateField[];
}

function draftFor(template: AgentTemplate): SheetDraft {
  return {
    model: AGENT_MODEL_DEFAULT,
    fields: template.fields.map((field) => ({ ...field })),
  };
}

/**
 * The roster, with the empty option RE-WORDED for this surface.
 *
 * ⚠ "Template default", not "Default" (`agent-models.ts › AGENT_MODEL_OPTIONS`
 * says the latter). Same wire value, different FACT: on the Settings row the
 * empty string means "let the SDK choose", and here it means "let the TEMPLATE
 * choose" — and the template may well carry a model, in which case "Default"
 * would name the wrong thing. The mapping lives here and only here, exactly as
 * `../lib/visibility.ts` owns "Public" over `workspace`.
 *
 * ⚠ `agentModelOptionsFor` rather than the bare roster: a template may store a
 * model id THIS build has never heard of (the roster is the SDK's and moves
 * faster than this tree ships), and a `SelectMenu` whose value matches no option
 * renders BLANK — the surface saying nothing where it has an answer.
 */
function modelOptions(template: AgentTemplate) {
  return agentModelOptionsFor(template.model).map((option) =>
    option.value === AGENT_MODEL_DEFAULT
      ? { ...option, label: "Template default" }
      : option
  );
}

export function TemplateLaunchSheet({
  open,
  template,
  busy = false,
  onCancel,
  onLaunch,
}: {
  open: boolean;
  /** `null` keeps the shell mounted through its exit animation. */
  template: AgentTemplate | null;
  busy?: boolean;
  onCancel: () => void;
  onLaunch: (overrides: TemplateLaunchOverrides | undefined) => void;
}) {
  // ⚠ DRAFT RESET IS DERIVED FROM THE TEMPLATE ID DURING RENDER, never from an
  // effect — an effect paints one frame of the PREVIOUS template's values into
  // the new sheet, and set-state in an effect body is the cascading render the
  // lint rule forbids (`./template-editor.tsx` carries the same pattern).
  const [loaded, setLoaded] = useState(() => ({
    id: template?.id ?? null,
    draft: template ? draftFor(template) : null,
  }));
  if (template && loaded.id !== template.id) {
    setLoaded({ id: template.id, draft: draftFor(template) });
  }
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const draft = loaded.draft;
  const heading = template ? `Launch — ${template.name}` : "Launch";
  const instructions = template?.instructions?.trim() ?? "";

  function editField(index: number, patch: Partial<TemplateField>) {
    setLoaded((prev) =>
      prev.draft === null
        ? prev
        : {
            ...prev,
            draft: {
              ...prev.draft,
              fields: prev.draft.fields.map((f, i) =>
                i === index ? { ...f, ...patch } : f
              ),
            },
          }
    );
  }

  return (
    <ModalShell open={open} onClose={onCancel} label={heading} size="narrow">
      <button
        type="button"
        className={modalStyles.close}
        onClick={onCancel}
        aria-label="Close launch options"
      >
        <X size={18} />
      </button>

      <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto p-6">
        <h2 className="text-title font-semibold text-text-primary">{heading}</h2>

        {template && draft && (
          <>
            <Field label="Model">
              <SelectMenu
                value={draft.model}
                options={modelOptions(template)}
                onChange={(model) =>
                  setLoaded((prev) =>
                    prev.draft === null
                      ? prev
                      : { ...prev, draft: { ...prev.draft, model } }
                  )
                }
                ariaLabel="Model"
                disabled={busy}
                className="w-fit"
              />
            </Field>

            {/* ⚠ THE TEMPLATE'S OWN FIELDS, AND NO ADD/REMOVE. The editor grows
                and shrinks the set (`./template-editor-rows.tsx ›
                CustomFieldRows`); a launch RE-POINTS the ones that exist. An
                add button here would make the sheet a place to author a field
                that then vanishes when the session ends. */}
            {draft.fields.length > 0 && (
              <Field label="Fields">
                <div className="flex flex-col gap-1.5">
                  {draft.fields.map((field, index) => (
                    // ⚠ Keyed by index on purpose — a launch field has no id,
                    // and keying by `field.key` would remount the very input the
                    // operator is typing that key into.
                    <div key={index} className="flex items-center gap-1.5">
                      <input
                        value={field.key}
                        onChange={(e) => editField(index, { key: e.target.value })}
                        maxLength={MAX_OVERRIDE_KEY_CHARS}
                        disabled={busy}
                        aria-label={`Field ${index + 1} key`}
                        className={cn(
                          RAISED_INPUT,
                          "h-8 flex-[2] px-2.5 font-mono text-small"
                        )}
                      />
                      <input
                        value={field.value}
                        onChange={(e) => editField(index, { value: e.target.value })}
                        maxLength={MAX_OVERRIDE_VALUE_CHARS}
                        disabled={busy}
                        aria-label={`Field ${index + 1} value`}
                        className={cn(RAISED_INPUT, "h-8 flex-[3] px-2.5")}
                      />
                    </div>
                  ))}
                </div>
              </Field>
            )}

            {instructions && (
              <Field label="Instructions">
                <button
                  type="button"
                  onClick={() => setInstructionsOpen((prev) => !prev)}
                  aria-expanded={instructionsOpen}
                  className="flex w-fit items-center gap-1 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
                >
                  {instructionsOpen ? (
                    <ChevronDown size={13} aria-hidden />
                  ) : (
                    <ChevronRight size={13} aria-hidden />
                  )}
                  {instructionsOpen ? "Hide" : "Read"}
                </button>
                {instructionsOpen && (
                  // ⚠ VERBATIM AND READ-ONLY. `whitespace-pre-wrap` because the
                  // text IS the prompt: collapsing its line breaks would show
                  // the operator something other than what runs.
                  <div
                    className={cn(
                      RAISED_INPUT,
                      "max-h-[220px] overflow-y-auto whitespace-pre-wrap px-3 py-2 text-small leading-relaxed"
                    )}
                  >
                    {instructions}
                  </div>
                )}
              </Field>
            )}

            {/* THE ONE LINE OF COPY THIS SHEET EARNS (INVARIANTS §5). */}
            <p className="text-caption text-text-muted">
              Applies to this run only.
            </p>
          </>
        )}

        <div className="flex items-center gap-2 pt-1">
          <span className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="auth-btn-3d-light h-10 rounded-[9px] px-4 text-body font-medium text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              template &&
              draft &&
              onLaunch(overridesFor(template, draft.model, draft.fields))
            }
            disabled={busy || !template}
            className="auth-btn-3d h-10 rounded-[9px] px-4 text-body font-medium text-white disabled:opacity-40"
          >
            {busy ? "Starting…" : "Launch"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

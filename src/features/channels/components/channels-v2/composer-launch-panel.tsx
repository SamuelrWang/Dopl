"use client";

/**
 * THE COMPOSER'S LAUNCH PANEL — who the new agent is, before it exists (2026-08-27, Samuel's
 * launch-panel ruling). Split from `composer.tsx` on the seam
 * `composer-request-panel.tsx` was split on: that file is about SENDING, this is one FORM.
 *
 * ⚠ IT REPLACED THE TEMPLATE CHEVRON, which is DELETED. The Bot icon had a second glyph beside
 * it opening a template menu; that menu's whole function — pick an identity, or none — is the
 * Template row here. **Do not re-add a chevron**: two ways to choose an identity is how the
 * thread panel and the Bot icon drifted into meaning the same thing in 2026-08-21.
 *
 * ⚠ IT IS THE NEW-THREAD PANEL'S TWIN, DELIBERATELY, and shares its parts rather than copying
 * them: the same concave `SECTION_BOX_INSET` body recessed into the composer card, the same
 * `RAISED_WELL` cards on it, the same `Label:` + `UNDERLINE_FIELD` rows, the same
 * `data-composer-panel` hook that lets /home repaint the recess with the account palette. Two
 * panels that read as one kind of object, because they are.
 *
 * ⚠ THE ID ROW IS DISPLAY-ONLY AND IS NOT ALWAYS THERE. It shows the address main pre-assigned
 * (`use-agent-launch.ts`), and on a desktop too old to honour a pre-assigned id there is nothing
 * true to show yet — so it says so, rather than showing an id the agent will not have. That
 * whole argument lives in `use-agent-launch.ts`; what matters here is that the row NEVER renders
 * a guess (INVARIANTS §11 — UNKNOWN is not EMPTY).
 */

import { useRef } from "react";
import { X } from "lucide-react";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { SelectMenu } from "@/shared/ui/select-menu";
import { cn } from "@/shared/lib/utils";
import { AGENT_MODEL_OPTIONS } from "../../lib/agent-models";
import { IconButton } from "./bits";
import {
  FIELD_INPUT,
  PANEL_BODY,
  PANEL_HOOK,
  PanelField,
} from "./composer-request-panel";
import type { AgentLaunchPanel } from "./use-agent-launch";
import { useAutoGrow } from "./use-auto-grow";

/** A template row as the selector needs it — the read hook's shape, narrowed. */
export interface LaunchTemplateOption {
  id: string;
  name: string;
}

/** The blank-agent option's value. ⚠ `""` because `SelectMenu` is `<T extends string>`; it maps
 *  to `templateId: null` at the boundary, which is the wire's own spelling of "no template". */
const BLANK_TEMPLATE = "";

export function AgentLaunchPanelView({
  panel,
  templates,
}: {
  panel: AgentLaunchPanel;
  /** The channel's templates. ⚠ READ-ONLY here — this surface authors none. */
  templates: ReadonlyArray<LaunchTemplateOption>;
}) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(descriptionRef, panel.description);
  const templateOptions = [
    // ⚠ FIRST, AND NOT A PLACEHOLDER. A blank agent is a real configuration — it is what the Bot
    // icon spawned in one click for a year — so it is an option, not an empty state.
    { value: BLANK_TEMPLATE, label: "Blank agent" },
    ...templates.map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <div
      {...PANEL_HOOK}
      className={cn(
        SECTION_BOX_INSET,
        "flex min-h-0 flex-col gap-2 rounded-[10px] p-2.5",
      )}
    >
      <div className="flex items-center gap-2">
        {/* Sentence case at normal weight — `text-caption`, for the reason
            `composer-request-panel.tsx` states over its own header. */}
        <span className="text-caption text-text-secondary">New agent</span>
        <span className="flex-1" />
        <IconButton
          icon={X}
          label="Close new agent"
          size={13}
          className="h-5 w-5"
          onClick={panel.close}
        />
      </div>

      <div className={PANEL_BODY}>
        <PanelField label="Name:">
          <input
            type="text"
            value={panel.name}
            onChange={(e) => panel.setName(e.target.value)}
            spellCheck={false}
            aria-label="Agent name"
            className={cn(FIELD_INPUT, "flex-1")}
          />
        </PanelField>

        <PanelField label="Description:">
          {/* ⚠ ONE LINE AT REST, GROWING TO THREE — the composer's own mechanism, extracted
            (`use-auto-grow.ts`). It was `rows={3}`, which made the panel tall before a word
            was typed. */}
          <textarea
            ref={descriptionRef}
            value={panel.description}
            onChange={(e) => panel.setDescription(e.target.value)}
            rows={1}
            spellCheck={false}
            aria-label="Agent description"
            className={cn(FIELD_INPUT, "flex-1 resize-none")}
          />
        </PanelField>

        <PanelField label="Template:" as="div" center line={false}>
          <SelectMenu
            value={panel.templateId ?? BLANK_TEMPLATE}
            options={templateOptions}
            onChange={(next) =>
              panel.setTemplateId(next === BLANK_TEMPLATE ? null : next)
            }
            ariaLabel="Agent template"
            variant="raisedField"
            className="min-w-0 flex-1"
          />
        </PanelField>

        <PanelField label="Model:" as="div" center line={false}>
          {/* ⚠ `AGENT_MODEL_OPTIONS`, NOT `agentModelOptionsFor`. That one widens the roster with
            whatever a LIVE agent is already running; nothing is running yet, so the list here is
            the plain vocabulary and "Default" means the launch chain decides
            (`session-launch-op.js`'s precedence block). */}
          <SelectMenu
            value={panel.model}
            options={AGENT_MODEL_OPTIONS}
            onChange={panel.setModel}
            ariaLabel="Agent model"
            variant="raisedField"
            className="min-w-0 flex-1"
          />
        </PanelField>

        {/* ⚠ A REFUSAL AFTER THE AGENT STARTED, said out loud on its own line. The launch SUCCEEDED
          — reporting it as a failure would be a lie about the thing that mattered — but a name or
          description main would not take must not vanish silently either. */}
        {panel.identityError && (
          <p role="alert" className="px-0.5 text-caption text-danger">
            {panel.identityError}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * THE WHOLE NEW-AGENT SURFACE — the collapse region, the panel, the templates read and the
 * foreign-template question — as ONE mount.
 *
 * ⚠ IT EXISTS SO THE TEMPLATES READ IS GATED BY THE SAME `canLaunch` THE CONTROL IS. The read is
 * a react-query hook, so calling it from `composer.tsx`'s top level would require a
 * `QueryClientProvider` around every surface that renders a composer — including the pop-out and
 * the web tree, which have no launch affordance at all and had no such requirement before. The
 * retired `TemplateLaunchPicker` was mounted under exactly this condition and this keeps that
 * property rather than quietly widening it.
 *
 * ⚠ THE COLLAPSE REGION IS INSIDE, so the panel's own content decides how far the composer card
 * grows and no layout number is hardcoded; `motion-reduce` snaps it.
 */
export function ComposerLaunch({
  panel,
  workspaceId,
}: {
  panel: AgentLaunchPanel;
  workspaceId: string;
}) {
  // ⚠ NOT REQUESTED UNTIL THE PANEL IS OPEN, and it is the SAME cache entry the Agents tab and
  // the /home Agents face mount — a stable key on `[path, workspaceId, query]` (F-331), so two
  // mounts share one fetch. ⚠ READ-ONLY: this surface authors no template.
  const { templates } = useAgentTemplates(workspaceId, { enabled: panel.open });

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        panel.open
          ? "grid-rows-[1fr] opacity-100"
          : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden" inert={!panel.open}>
        <div className="pb-2">
          <AgentLaunchPanelView panel={panel} templates={templates} />
        </div>
      </div>
    </div>
  );
}

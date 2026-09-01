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

import { useMemo, useRef } from "react";
import { X } from "lucide-react";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import { useChannelLaunchPosture } from "../../hooks/use-channel-launch-posture";
import {
  descriptorFor,
  interruptRefusal,
  type RuntimeDescriptor,
} from "../../lib/runtime-capability";
import { authorMarker } from "@/features/agent-templates/components/template-picker";
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

/**
 * A template row as the selector needs it — the read hook's shape, narrowed.
 *
 * 🔒 ⚠ `marker` IS A SECURITY SIGNAL, NOT DECORATION, AND IT IS WHY THIS TYPE IS
 * NOT `{id, name}` (RESTORED 2026-08-30 — ledger ASK-21, INVARIANTS §5A).
 * A `team` / `workspace` template's instructions are another member's text about
 * to run on this machine under this operator's credential. §5A: the marker is
 * *"the ONLY signal shown to the human BEFORE the choice is made"* — and when
 * this panel replaced the composer's template chevron on 2026-08-27 it narrowed
 * the list to id + name, so the pre-choice signal was lost on the surface now
 * taking most of the launch traffic. (`TemplateApprovalDialog` still fires on
 * first use, so the FENCE held; what was lost is the warning before the click.)
 *
 * ⚠ IT IS `template-picker.tsx › authorMarker`'s ANSWER, never a second copy:
 * an author the channel roster cannot name reads `by another member` rather than
 * losing the marker, because dropping it would turn UNKNOWN into MINE.
 * `null` = this operator's own template, which wears no marker (a marker over
 * your own configuration is the noise that stops markers being read).
 */
export interface LaunchTemplateOption {
  id: string;
  name: string;
  marker: string | null;
}

/** The blank-agent option's value. ⚠ `""` because `SelectMenu` is `<T extends string>`; it maps
 *  to `templateId: null` at the boundary, which is the wire's own spelling of "no template". */
const BLANK_TEMPLATE = "";

/**
 * "Whatever this channel is set to" — the Runtime row's first option, and a REAL pick.
 *
 * ⚠ ITS `""` MEANS SOMETHING DIFFERENT FROM THE SETTINGS ROW'S, WHICH IS WHY THE LABEL DIFFERS.
 * On the DURABLE record `''` sets the channel back to the DEFAULT ADAPTER; here it means the
 * operator expressed no per-spawn preference, so `main/session-launch-op.js`'s chain falls
 * through to the channel's own pick. Labelling both "Default" would claim this row can reset a
 * setting it never touches.
 */
const CHANNEL_RUNTIME = "";
const CHANNEL_RUNTIME_LABEL = "Channel default";

export function AgentLaunchPanelView({
  panel,
  templates,
  runtimes = EMPTY_RUNTIMES,
  channelRuntime = "",
  defaultRuntime = "",
}: {
  panel: AgentLaunchPanel;
  /** The channel's templates. ⚠ READ-ONLY here — this surface authors none. */
  templates: ReadonlyArray<LaunchTemplateOption>;
  /**
   * THE RUNTIME FAMILY, off the channel's launch posture (2026-08-31, design §3.1/§3.2).
   * ⚠ EMPTY RENDERS NO RUNTIME ROW AND NO WARNING — a plain browser, and every desktop older
   * than the port. It is the same no-dead-rows rule the Settings tab's row follows, and here
   * it is the stronger one: an older main accepts `payload.runtime` and drops it.
   */
  runtimes?: ReadonlyArray<RuntimeDescriptor>;
  /** The channel's durable pick, `''` for the default adapter. */
  channelRuntime?: string;
  defaultRuntime?: string;
}) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(descriptionRef, panel.description);
  /**
   * WHAT THIS SPAWN WOULD ACTUALLY RUN ON — the panel's own pick, else the channel's, else
   * the default. ⚠ IT MIRRORS MAIN'S PRECEDENCE CHAIN EXACTLY (`session-launch-op.js`:
   * `p.runtime > getChannelRuntime > ''`). A warning computed off any other order would name
   * a refusal belonging to a runtime this launch is not about to use.
   */
  const effective = useMemo(
    () => descriptorFor(runtimes, panel.runtime || channelRuntime, defaultRuntime),
    [runtimes, panel.runtime, channelRuntime, defaultRuntime]
  );
  // ⚠ A REFUSAL, NOT AN ABSENCE, AND THAT IS WHY IT IS A SENTENCE (§3.2). Without an
  // interrupt Dopl cannot stop a session it started, so the Stop control on the agent panel
  // goes inert — and a control that vanishes with no reason is one the operator works around.
  // The launch surface is where they can still choose differently, so it is where it is said.
  const stopWarning = runtimes.length ? interruptRefusal(effective) : null;
  const templateOptions = [
    // ⚠ FIRST, AND NOT A PLACEHOLDER. A blank agent is a real configuration — it is what the Bot
    // icon spawned in one click for a year — so it is an option, not an empty state.
    { value: BLANK_TEMPLATE, label: "Blank agent" },
    // 🔒 ⚠ THE MARKER RIDES `description`, WHICH IS HOW IT REACHES THE ACCESSIBLE NAME.
    // `MenuItem` renders `description` INSIDE the `role="menuitem"` button, so content-based
    // naming puts "by <member>" in the row's accessible name as well as on its face — the same
    // two places `template-picker.tsx › TemplateRow` puts it (there via `aria-label`, because
    // that row hand-builds its own name). A screen-reader operator gets the same pre-choice
    // signal a sighted one does. ⚠ `undefined`, never `""`: an empty description would render an
    // empty second line under every own-template row.
    ...templates.map((t) => ({
      value: t.id,
      label: t.name,
      description: t.marker ?? undefined,
    })),
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

        {/* ⚠ ABOVE Model, BELOW Template, because it decides what the two rows under it
            mean — the model roster and the permission vocabulary are the RUNTIME's. */}
        {runtimes.length > 0 && (
          <PanelField label="Runtime:" as="div" center line={false}>
            <SelectMenu
              value={panel.runtime}
              options={[
                { value: CHANNEL_RUNTIME, label: CHANNEL_RUNTIME_LABEL },
                // ⚠ THE PLATFORM'S OWN LABEL, off the descriptor — Dopl does not rename a
                // vendor's product, and a second table of names is the drift
                // `lib/agent-models.ts` states the rule against.
                ...runtimes.map((d) => ({ value: d.id, label: d.label })),
              ]}
              onChange={panel.setRuntime}
              ariaLabel="Agent runtime"
              variant="raisedField"
              className="min-w-0 flex-1"
            />
          </PanelField>
        )}

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
        {/* ⚠ ONE SENTENCE, AND THE ONE EXCEPTION TO THE MINIMAL-COPY RULING (INVARIANTS §5).
            It is the descriptor's own words (`runtime-capability.ts › interruptRefusal`), not
            Dopl's paraphrase, and it is a NOTE rather than an ALERT: nothing has failed, and
            the operator is being told what this runtime cannot do before they start it. */}
        {stopWarning && (
          <p role="note" className="px-0.5 text-caption text-warning">
            {stopWarning}
          </p>
        )}

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
  channelId,
  workspaceId,
  currentUserId,
  members,
}: {
  panel: AgentLaunchPanel;
  /** The channel whose durable posture supplies the runtime roster and the pick this
   *  launch falls through to. ⚠ The read is the SAME shared record the Settings tab
   *  writes (`use-channel-launch-posture.ts`), so a pick made there is live here. */
  channelId: string;
  workspaceId: string;
  /** Whose templates wear NO marker — everyone else's wear one. */
  currentUserId: string;
  /** The CHANNEL roster, for the marker's name half. ⚠ Not the workspace's: a
   *  template shared by someone outside this channel resolves to no name and
   *  degrades to "by another member" rather than disappearing — the same
   *  argument `agents-tab.tsx` states over its own map. */
  members: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }>;
}) {
  // ⚠ NOT REQUESTED UNTIL THE PANEL IS OPEN, and it is the SAME cache entry the Agents tab and
  // the /home Agents face mount — a stable key on `[path, workspaceId, query]` (F-331), so two
  // mounts share one fetch. ⚠ READ-ONLY: this surface authors no template.
  const { templates } = useAgentTemplates(workspaceId, { enabled: panel.open });
  // ⚠ GATED BY THE SAME MOUNT THE TEMPLATES READ IS. This component renders only where a
  // launch is possible, so the bridge read costs nothing on a surface with no launch control.
  const posture = useChannelLaunchPosture(channelId);

  const memberNames = useMemo(
    () =>
      new Map(members.map((m) => [m.userId, m.displayName || m.email || ""] as const)),
    [members]
  );
  // 🔒 THE MARKER IS ATTACHED HERE, BESIDE THE READ, so the view takes rows that already carry
  // the signal and there is no arm of it that renders a template without one (ledger ASK-21).
  const options = useMemo(
    () =>
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        marker: authorMarker(t, currentUserId, memberNames),
      })),
    [templates, currentUserId, memberNames]
  );

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
          <AgentLaunchPanelView
            panel={panel}
            templates={options}
            // ⚠ EMPTY UNTIL THE PROBE ANSWERS, and empty forever off-desktop — which renders
            // no runtime row and no warning, the correct direction while the answer is out.
            runtimes={posture.runtimeSupported ? posture.runtimes : EMPTY_RUNTIMES}
            channelRuntime={posture.runtime}
            defaultRuntime={posture.defaultRuntime}
          />
        </div>
      </div>
    </div>
  );
}

/** ⚠ Module-level, so a surface with no runtime concept hands the view the SAME array every
 *  render rather than a fresh identity `effective` would re-derive from. */
const EMPTY_RUNTIMES: ReadonlyArray<RuntimeDescriptor> = [];

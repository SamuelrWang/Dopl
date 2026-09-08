"use client";

/**
 * THE NEW-AGENT POPUP — the launch form as a centered dialog (2026-09-08, Samuel's
 * popup-panel ruling), and the FIRST surface in the app built to it.
 *
 * His words, verbatim, because this file is the only place they are written down:
 * *"Right now, as you can see it is like a slide out panel thingy. Im thinking to scrap that and
 * unwire it from the text input bar, and instead, make it a pop up panel … instead of a box
 * though, it would be an underline … the user would click on the line, and the line will turn
 * from gray to black, in an animation that makes it turn color from left to right … for template,
 * instead of a dropdown, I think it should be a selector … and for model … a pill like selector …
 * Make the dimensions that of the 30px."*
 *
 * ⚠ **IT IS AN EXPERIMENT AND THE SLIDE-OUT IS STILL IN THE TREE.** Samuel:
 * *"This is a new UI im testing, so we can code this separate, and if this looks good for pop up
 * panels, we'll go across the app to change to match this UI."* `composer-launch-panel.tsx` is
 * unreferenced from the Bot icon as of this change and is otherwise untouched —
 * `runtime-refusals.test.tsx` still mounts `AgentLaunchPanelView` directly, so the old face keeps
 * its own pins until he rules. **Delete it when he does; do not let two launch forms live.**
 *
 * ⚠ **NOTHING ABOUT THE LAUNCH LANE CHANGED, AND THAT IS THE POINT OF REUSING
 * {@link useLaunchRunner}.** The act is still `use-agent-launch.ts › launchWithIdentity` —
 * spawn, then rename, then describe, with the pre-assigned id on the fourth argument and the
 * foreign-template question answered by the same modal. This file is a FACE. If a payload
 * assertion in `composer-launch.test.tsx` ever has to change to accommodate it, the change is
 * wrong: `launch-agent-dialog.test.tsx › the payload is the slide-out's, byte for byte` is the
 * standing proof that it did not.
 *
 * ⚠ **THE SUBMIT MOVED BACK INSIDE THE FORM, AND THAT SUPERSEDES THE 2026-08-27 RULING** that
 * the panel *"carries NO submit of its own — one control, context-labeled"*. That rule was about
 * two submits on ONE CARD; a modal is not on the composer's card, and a dialog whose verb lived
 * in the surface behind its own scrim would be unreachable. The composer's send control is
 * therefore plain "Send" again while this is open — there is still exactly one Launch on screen.
 *
 * ⚠ **THE RUNTIME ROW SITS UNDER MODEL HERE**, where the slide-out put it between Template and
 * Model on the stated grounds that it *"decides what the two rows under it mean"*. Samuel's
 * ordering for the popup is Name, Description, Template, Model, Runtime, and an ordering ruled
 * for a surface outranks a rationale written for the other one. The precedence chain it feeds is
 * untouched.
 */

import { useMemo, useState } from "react";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import { authorMarker } from "@/features/agent-templates/components/template-picker";
import { TemplateApprovalDialog } from "@/features/agent-templates/components/template-approval";
import { DialogActions, StandardDialog } from "@/shared/ui/standard-dialog";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { cn } from "@/shared/lib/utils";
import { useChannelLaunchPosture } from "../../hooks/use-channel-launch-posture";
import {
  descriptorFor,
  interruptRefusal,
  type RuntimeDescriptor,
} from "../../lib/runtime-capability";
import { agentModelOptionsFor, agentModelSelection } from "../../lib/agent-models";
import type { AgentLaunchControls } from "./use-agents-panel";
import { useLaunchRunner, type AgentLaunchPanel } from "./use-agent-launch";
import styles from "./launch-agent-dialog.module.css";

/** The blank-agent option's key. ⚠ `""` because `SegmentedControl` is `<K extends string>`; it
 *  maps to `templateId: null` at the boundary, which is the wire's own spelling of "no
 *  template". Same sentinel `composer-launch-panel.tsx` uses, for the same reason. */
const BLANK_TEMPLATE = "";

/** "Whatever this channel is set to". ⚠ `''` here means the operator expressed NO per-spawn
 *  preference, which is a different fact from the Settings row's `''` (that one RESETS the
 *  channel to the default adapter). Labelling both "Default" would claim this row can write a
 *  setting it never touches. */
const CHANNEL_RUNTIME = "";
const CHANNEL_RUNTIME_LABEL = "Channel default";

/** ⚠ Module-level, so a surface with no runtime concept hands the same array every render. */
const EMPTY_RUNTIMES: ReadonlyArray<RuntimeDescriptor> = [];

/** Discard — the composer's own text-button face, at `--action-h-sm`. */
const DISCARD_BTN =
  "flex h-[var(--action-h-sm)] items-center rounded-[8px] px-2.5 text-caption font-medium " +
  "text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

/** Launch — the composer's black CTA face, at `--action-h-sm`. */
const LAUNCH_BTN =
  "auth-btn-3d flex h-[var(--action-h-sm)] items-center rounded-[8px] px-3.5 text-caption " +
  "font-semibold text-text-on-cta";

/**
 * ONE UNDERLINE ROW — label, then the line.
 *
 * ⚠ THE ACTIVE CLASS IS REACT STATE, NOT `:focus-within`, and the module states why: jsdom loads
 * no stylesheet, so a pure-CSS focus rule cannot be pinned on a rendered tree. The animation is
 * the CSS module's either way.
 */
function UnderlineField({
  label,
  value,
  onChange,
  ariaLabel,
  id,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  id: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={styles.row}>
      <label
        htmlFor={id}
        className={styles.label}
      >
        {label}
      </label>
      <span className={cn(styles.line, focused && styles.lineActive)}>
        <input
          id={id}
          type="text"
          className={styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          aria-label={ariaLabel}
        />
      </span>
    </div>
  );
}

/** One 30px borderless pill row. ⚠ `flex-wrap` is the LAYOUT and it is the consumer's, exactly
 *  as the kit's docblock says: a template roster has no width budget this file can promise. */
function PillRow<K extends string>({
  label,
  options,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string; hint?: string }>;
  value: K;
  onChange: (next: K) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={styles.label}>{label}</span>
      <SegmentedControl
        options={options}
        value={value}
        onChange={onChange}
        // ⚠ `plain` + `md` ARE THE RULING, IN TWO WORDS: gray fill with no
        // hairline, at `--action-h-sm`. Both live on the shared primitive.
        variant="plain"
        size="md"
        className="flex-wrap"
        // A `role="tablist"` with no name gives a screen-reader operator three
        // unlabelled groups — the visible word above it is not attached to it.
        ariaLabel={ariaLabel}
      />
    </div>
  );
}

export function LaunchAgentDialog({
  panel,
  newAgent,
  openThreadId,
  channelId,
  workspaceId,
  currentUserId,
  members,
}: {
  panel: AgentLaunchPanel;
  /** ⚠ ABSENT MEANS NO LAUNCH ON THIS SURFACE — the caller renders nothing at all. */
  newAgent?: AgentLaunchControls;
  /** Which exchange the new agent lands on; `null` is a CHANNEL-LEVEL agent. */
  openThreadId: string | null;
  channelId: string;
  workspaceId: string;
  /** Whose templates wear NO marker — everyone else's wear one. */
  currentUserId: string;
  /** The CHANNEL roster, for the marker's name half. ⚠ Not the workspace's: a template shared
   *  by someone outside this channel degrades to "by another member" rather than losing its
   *  marker, because dropping it would turn UNKNOWN into MINE. */
  members: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }>;
}) {
  // ⚠ NOT REQUESTED UNTIL THE DIALOG IS OPEN, and it is the SAME cache entry the Agents tab
  // mounts — a stable key on `[path, workspaceId, query]` (F-331). ⚠ READ-ONLY.
  const { templates } = useAgentTemplates(workspaceId, { enabled: panel.open });
  const posture = useChannelLaunchPosture(channelId);
  // ⚠ THE RUNNER LIVES HERE NOW, beside the button that fires it — see the header's note on the
  // submit moving back inside the form. It reaches `launchWithIdentity` unchanged.
  const runner = useLaunchRunner({ newAgent, panel, openThreadId });

  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName || m.email || ""] as const)),
    [members]
  );

  // ⚠ EMPTY UNTIL THE PROBE ANSWERS, and empty forever off-desktop — which renders NO runtime
  // row and no warning, the correct direction while the answer is out (INVARIANTS §11).
  const runtimes = posture.runtimeSupported ? posture.runtimes : EMPTY_RUNTIMES;
  const channelModel = posture.modelSupported ? posture.posture.model ?? "" : "";

  /**
   * 🔒 THE MARKER IS ATTACHED BESIDE THE READ, so no arm of this renders a template without one
   * (ledger ASK-21, INVARIANTS §5A). It rides `hint`, which `SegmentedControl` renders INSIDE
   * the option button — so it reaches the accessible name as well as the face, the same two
   * places the retired `SelectMenu` row put it.
   */
  const templateOptions = useMemo(
    () => [
      // ⚠ FIRST, AND NOT A PLACEHOLDER. A blank agent is a real configuration.
      { key: BLANK_TEMPLATE, label: "Blank agent" },
      ...templates.map((t) => ({
        key: t.id,
        label: t.name,
        hint: authorMarker(t, currentUserId, memberNames) ?? undefined,
      })),
    ],
    [templates, currentUserId, memberNames]
  );

  /**
   * WHAT THE MODEL ROW SHOWS — the operator's own pick, else the TEMPLATE's, else the CHANNEL's,
   * else the Sonnet back-fill. ⚠ THE ORDER IS MAIN'S, LINK FOR LINK
   * (`main/session-launch-op.js`), and it is DISPLAY ONLY: `panel.model` stays `''` until the
   * operator touches the control, so an untouched dialog puts no model on the wire at all.
   * A row that pre-selected the resolved id into `panel.model` would turn a channel's setting
   * into a per-spawn pick that then stops following the setting.
   */
  const effectiveModel = useMemo(() => {
    const fromTemplate = templates.find((t) => t.id === panel.templateId)?.model;
    return agentModelSelection(panel.model || fromTemplate || channelModel);
  }, [panel.model, templates, panel.templateId, channelModel]);
  // ⚠ `agentModelOptionsFor`, not the bare roster: a template or a channel may carry an id this
  // build predates, and an option list without it would render the row with no selection.
  const modelOptions = useMemo(
    () => agentModelOptionsFor(effectiveModel).map((o) => ({ key: o.value, label: o.label })),
    [effectiveModel]
  );

  const runtimeOptions = useMemo(
    () => [
      { key: CHANNEL_RUNTIME, label: CHANNEL_RUNTIME_LABEL },
      // ⚠ THE PLATFORM'S OWN LABEL, off the descriptor — Dopl does not rename a vendor's
      // product, and a second table of names is the drift `lib/agent-models.ts` forbids.
      ...runtimes.map((d) => ({ key: d.id, label: d.label })),
    ],
    [runtimes]
  );

  /**
   * WHAT THIS SPAWN WOULD ACTUALLY RUN ON. ⚠ IT MIRRORS MAIN'S PRECEDENCE CHAIN EXACTLY
   * (`p.runtime > getChannelRuntime > ''`); a warning computed off any other order would name a
   * refusal belonging to a runtime this launch is not about to use.
   */
  const effectiveRuntime = useMemo(
    () => descriptorFor(runtimes, panel.runtime || posture.runtime, posture.defaultRuntime),
    [runtimes, panel.runtime, posture.runtime, posture.defaultRuntime]
  );
  const stopWarning = runtimes.length ? interruptRefusal(effectiveRuntime) : null;

  // ⚠ ESCAPE AND THE BACKDROP ARE DISCARD (Samuel's ruling names two exits and this is the
  // second). `reset` closes AND clears — a dialog that came back holding a half-typed identity
  // the operator dismissed would be remembering a decision they undid.
  const discard = () => panel.reset();

  return (
    <>
      <StandardDialog
        open={panel.open}
        onClose={discard}
        title="New agent"
        closeLabel="Close new agent"
      >
        <UnderlineField
          id="launch-agent-name"
          label="Name"
          value={panel.name}
          onChange={panel.setName}
          ariaLabel="Agent name"
        />
        <UnderlineField
          id="launch-agent-description"
          label="Description"
          value={panel.description}
          onChange={panel.setDescription}
          ariaLabel="Agent description"
        />

        <PillRow
          label="Template"
          options={templateOptions}
          value={panel.templateId ?? BLANK_TEMPLATE}
          onChange={(next) => panel.setTemplateId(next === BLANK_TEMPLATE ? null : next)}
          ariaLabel="Agent template"
        />

        <PillRow
          label="Model"
          options={modelOptions}
          value={effectiveModel}
          onChange={panel.setModel}
          ariaLabel="Agent model"
        />

        {/* ⚠ NO ROW WHERE THERE IS NO RUNTIME FAMILY — a plain browser, and every desktop older
            than the adapter port. The same no-dead-rows rule the Settings tab's row follows. */}
        {runtimes.length > 0 && (
          <PillRow
            label="Runtime"
            options={runtimeOptions}
            value={panel.runtime}
            onChange={panel.setRuntime}
            ariaLabel="Agent runtime"
          />
        )}

        {/* ⚠ ONE SENTENCE, AND THE ONE EXCEPTION TO THE MINIMAL-COPY RULING (INVARIANTS §5). It
            is the descriptor's own words, and it is a NOTE rather than an ALERT: nothing has
            failed, and the operator is told what this runtime cannot do BEFORE they start it. */}
        {stopWarning && (
          <p role="note" className="text-caption text-warning">
            {stopWarning}
          </p>
        )}

        {/* ⚠ A REFUSAL IS SAID OUT LOUD, HERE, because nothing else will: main answering
            `{ok:false}` changes nothing on its side, so no push follows to explain the button
            that visibly did nothing. */}
        {newAgent?.launchError && (
          <p role="alert" className="text-caption text-danger">
            {newAgent.launchError}
          </p>
        )}
        {/* ⚠ THE AGENT IS ALREADY RUNNING when this shows. The dialog STAYS OPEN holding the
            report rather than closing over it. */}
        {panel.identityError && (
          <p role="alert" className="text-caption text-danger">
            {panel.identityError}
          </p>
        )}

        <DialogActions>
          <button type="button" className={DISCARD_BTN} onClick={discard}>
            Discard
          </button>
          <button
            type="button"
            className={cn(LAUNCH_BTN, !panel.ready && "cursor-not-allowed opacity-60")}
            onClick={runner.launch}
            disabled={!panel.ready || newAgent?.launchBusy}
            // ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4) — the same sentence the
            // composer's context-labeled control carried, moved with the button.
            title={panel.ready ? "Launch" : "An agent needs a name"}
          >
            Launch
          </button>
        </DialogActions>
      </StandardDialog>

      {/* ⚠ A FOREIGN TEMPLATE'S FIRST RUN ON THIS MACHINE IS A QUESTION, NOT A FAILURE, and it
          is a SECOND dialog rather than a region inside this one: it shows instructions another
          member wrote, and nesting them in the form the operator is filling in is how untrusted
          text comes to look like part of Dopl's own chrome. */}
      <TemplateApprovalDialog
        open={runner.approval !== null}
        request={runner.approval}
        busy={newAgent?.launchBusy}
        onCancel={runner.cancelApproval}
        onConfirm={runner.confirmApproval}
      />
    </>
  );
}

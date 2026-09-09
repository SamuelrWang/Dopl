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
 * ⚠ **THE RECIPE LEFT THIS FILE THE SAME DAY** (`shared/ui/form-dialog.tsx`). Samuel: *"i want to
 * start conforming all pop ups to the UI of the one we just made, we should make a design system
 * for this."* Shell, section label, underline field, pill row and footer pair are the KIT's; what
 * is left here is this dialog's five rows and its launch lane.
 * ⚠ **THE SLIDE-OUT IS STILL IN THE TREE.** `composer-launch-panel.tsx` is unreferenced from the
 * Bot icon and keeps its own pins (`runtime-refusals.test.tsx`) until Samuel rules.
 * **Delete it when he does; do not let two launch forms live.**
 *
 * ⚠ **NOTHING ABOUT THE LAUNCH LANE CHANGED — the point of reusing {@link useLaunchRunner}.** The
 * act is still `use-agent-launch.ts › launchWithIdentity`. This file is a FACE: if a payload
 * assertion in `composer-launch.test.tsx` ever has to change for it, the change is wrong.
 *
 * ⚠ **THE SUBMIT MOVED BACK INSIDE THE FORM, SUPERSEDING THE 2026-08-27 RULING** that the panel
 * *"carries NO submit of its own — one control, context-labeled"*. That rule was about two submits
 * on ONE CARD; a dialog whose verb lived behind its own scrim would be unreachable. The composer's
 * control is plain "Send" while this is open — still exactly one Launch on screen.
 *
 * ⚠ **THE RUNTIME ROW SITS UNDER MODEL HERE.** The slide-out put it between Template and Model
 * because it *"decides what the two rows under it mean"*; Samuel's popup ordering is Name,
 * Description, Template, Model, Runtime.
 *
 * ⚠ **NO "CHANNEL DEFAULT", AND THIS SPAWN'S RUNTIME IS ALWAYS ON THE WIRE (2026-09-08, Samuel).**
 * *"for runtime, there shouldn't be a channel default. I don't even know what the logic behind
 * that is, but can we unwire that? It should just be what the user is already connected to, right?
 * … Nobody knows what channel default is."* Options are the runtimes THIS DESKTOP REPORTED
 * (`use-channel-launch-posture.ts › runtimes`), and the selection is always sent. **One reported
 * runtime still RENDERS the row**, so the operator sees what will run.
 *
 * ⚠ **EVERY REPORTED RUNTIME IS AN OPTION, CONNECTED OR NOT — SUPERSEDING THE PASS THAT NARROWED
 * THIS ROW TO THE CONNECTED ONES (2026-09-08, Samuel's correction):** *"No, even if the user does
 * not have codex or cursor connected, I still want them to be options there so that the user knows
 * that those are options, so they can connect them. It should just be logged in, like it is just
 * put in their default, right? I did not say to remove them."* Connectivity buys only (a) the muted
 * **"not connected"** hint and (b) where the PRESELECT lands. ⚠ **AN UNCONNECTED PILL STAYS
 * SELECTABLE** — a setup step, not a missing capability, and `acquire`'s spawn-time refusal
 * explains the rest.
 *
 * ⚠ **THE PRESELECT IS A FOUR-LINK CHAIN AND EACH LINK IS LOAD-BEARING** ({@link pickRuntime}):
 * the operator's own pick → the channel's stored pick IF connected (or if this desktop did not
 * say) → the first CONNECTED reported runtime → the first reported. Link 2's guard is the
 * correction's *"it should just be what the user is already connected to"*; its `or` is INVARIANTS
 * §8 — an older desktop reporting no connectivity keeps its stored pick. Link 4 is the
 * nothing-is-connected floor. `defaultRuntime` is deliberately not consulted: `main/runtime/
 * index.js › DEFAULT_ID` IS link 4 by construction, and a second authority could only disagree
 * with the pill on screen.
 *
 * ⚠ **NOTHING IS REPORTED ⇒ NO ROW AND NO RUNTIME KEY** — a plain browser, and every desktop older
 * than the adapter port (`runtimeSupported` false). The only lane left where this popup sends no
 * runtime (INVARIANTS §11 — UNKNOWN is not EMPTY).
 * ⚠ **THE CHANNEL-LEVEL POSTURE ITSELF IS UNTOUCHED** — Settings still writes it and
 * `main/session-launch-op.js` still reads it for launches carrying no runtime (MCP's included).
 */

import { useEffect, useMemo } from "react";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import { authorMarker } from "@/features/agent-templates/components/template-picker";
import { TemplateApprovalDialog } from "@/features/agent-templates/components/template-approval";
import { FormDialog, PillChoice, UnderlineField } from "@/shared/ui/form-dialog";
import { useChannelLaunchPosture } from "../../hooks/use-channel-launch-posture";
import { interruptRefusal } from "../../lib/runtime-capability";
import {
  EMPTY_CONNECTED,
  EMPTY_RUNTIMES,
  pickRuntime,
  runtimeRowOptions,
} from "./launch-agent-dialog-runtime";
import { agentModelOptionsFor, agentModelSelection } from "../../lib/agent-models";
import type { AgentLaunchControls } from "./use-agents-panel";
import { useLaunchRunner, type AgentLaunchPanel } from "./use-agent-launch";

/** The blank-agent option's key. ⚠ `""` because `SegmentedControl` is `<K extends string>`; it
 *  maps to `templateId: null` at the boundary, which is the wire's own spelling of "no
 *  template". Same sentinel `composer-launch-panel.tsx` uses, for the same reason. */
const BLANK_TEMPLATE = "";

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
  /**
   * The template roster's one input. ⚠ `null` IS A REAL ANSWER AND NOT AN EMPTY ROSTER — it is
   * "this caller has no workspace to list", so the read is not made and the Template row holds
   * Blank agent alone.
   */
  workspaceId: string | null;
  /** Whose templates wear NO marker — everyone else's wear one. */
  currentUserId: string;
  /** The CHANNEL roster, for the marker's name half. ⚠ Not the workspace's: a template shared
   *  by someone outside this channel degrades to "by another member" rather than losing its
   *  marker, because dropping it would turn UNKNOWN into MINE. */
  members: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }>;
}) {
  // ⚠ NOT REQUESTED UNTIL THE DIALOG IS OPEN, and it is the SAME cache entry the Agents tab
  // mounts — a stable key on `[path, workspaceId, query]` (F-331). ⚠ READ-ONLY.
  const { templates } = useAgentTemplates(workspaceId ?? "", {
    enabled: panel.open && workspaceId !== null,
  });
  const posture = useChannelLaunchPosture(channelId);
  // ⚠ THE RUNNER LIVES HERE NOW, beside the button that fires it — see the header's note on the
  // submit moving back inside the form. It reaches `launchWithIdentity` unchanged.
  const runner = useLaunchRunner({ newAgent, panel, openThreadId });
  // ⚠ DESTRUCTURED so the sync effect below can DEPEND on it: `panel` is a fresh object every
  // render, while `setRuntime` is `useAgentLaunch`'s own setState function and is stable.
  const { setRuntime } = panel;

  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName || m.email || ""] as const)),
    [members]
  );

  // ⚠ EMPTY UNTIL THE PROBE ANSWERS, and empty forever off-desktop — which renders NO runtime
  // row and no warning, the correct direction while the answer is out (INVARIANTS §11).
  const runtimes = posture.runtimeSupported ? posture.runtimes : EMPTY_RUNTIMES;
  // ⚠ THE ROSTER IS NEVER FILTERED BY THIS (Samuel's correction, quoted in the header). It labels
  // and it orders the preselect; it removes nothing.
  const connected = posture.runtimeSupported ? posture.connected : EMPTY_CONNECTED;
  const connectedKnown = posture.runtimeSupported && posture.connectedKnown;
  const channelModel = posture.modelSupported ? posture.posture.model ?? "" : "";

  /**
   * 🔒 THE MARKER IS ATTACHED BESIDE THE READ, so no arm of this renders a template without one
   * (ledger ASK-21, INVARIANTS §5A). It rides `hint`, which `SegmentedControl` renders INSIDE
   * the option button — so it reaches the accessible name as well as the face.
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

  // ⚠ EVERY REPORTED RUNTIME, NOTHING PREPENDED AND NOTHING REMOVED — the roster plus the
  // "not connected" hints. `launch-agent-dialog-runtime.ts` is the rule and Samuel's correction.
  const runtimeOptions = useMemo(
    () => runtimeRowOptions(runtimes, connected, connectedKnown),
    [runtimes, connected, connectedKnown]
  );

  /**
   * WHAT THIS SPAWN WILL RUN ON — one descriptor that is the SELECTION, the refusal sentence and
   * the payload at once. ⚠ ONE OBJECT ON PURPOSE: a row selecting one runtime while the warning
   * read another's refusals is what `runtime-capability.ts › descriptorFor` exists to prevent.
   * ⚠ THE OPERATOR'S OWN PICK OUTRANKS THE CHANNEL'S — main's order (`p.runtime >
   * getChannelRuntime`) with the fall-through removed, and since Samuel's 2026-09-08 correction
   * the channel's pick yields to CONNECTIVITY. {@link pickRuntime} is the whole chain.
   */
  const effectiveRuntime = useMemo(
    () => pickRuntime(runtimes, panel.runtime, posture.runtime, connected, connectedKnown),
    [runtimes, panel.runtime, posture.runtime, connected, connectedKnown]
  );
  /** `''` only where the desktop reported nothing — the no-row, no-key lane. */
  const selectedRuntime = effectiveRuntime?.id ?? "";
  const stopWarning = runtimes.length ? interruptRefusal(effectiveRuntime) : null;

  /**
   * THE SELECTION IS WRITTEN BACK INTO THE PANEL, so the pill on screen and the argument on the
   * wire are ONE value (`use-agent-launch.ts › launchWithIdentity` sends `panel.runtime`).
   *
   * ⚠ NOT THE MODEL ROW'S FORBIDDEN MOVE, AND THE DIFFERENCE IS THE RULING: `''` in the model row
   * means "follow the channel's setting", so stamping it would freeze a per-spawn copy. The
   * runtime row no longer has that meaning — Samuel removed the fall-through.
   * ⚠ IT RUNS ONLY WHILE OPEN, and `reset()` clears the field on close, so a dialog reopened after
   * the channel's pick moved re-derives.
   */
  useEffect(() => {
    if (!panel.open || !selectedRuntime || panel.runtime === selectedRuntime) return;
    setRuntime(selectedRuntime);
  }, [panel.open, panel.runtime, selectedRuntime, setRuntime]);

  // ⚠ ESCAPE AND THE BACKDROP ARE DISCARD (Samuel's ruling names two exits and this is the
  // second). `reset` closes AND clears — a dialog that came back holding a half-typed identity
  // the operator dismissed would be remembering a decision they undid.
  const discard = () => panel.reset();

  return (
    <>
      <FormDialog
        open={panel.open}
        onDiscard={discard}
        title="New agent"
        closeLabel="Close new agent"
        primary={{
          label: "Launch",
          onClick: runner.launch,
          disabled: !panel.ready,
          busy: newAgent?.launchBusy,
          // ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4) — the same sentence the
          // composer's context-labeled control carried, moved with the button.
          hint: panel.ready ? "Launch" : "An agent needs a name",
        }}
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
          multiline
          value={panel.description}
          onChange={panel.setDescription}
          ariaLabel="Agent description"
        />

        <PillChoice
          label="Template"
          options={templateOptions}
          value={panel.templateId ?? BLANK_TEMPLATE}
          onChange={(next) => panel.setTemplateId(next === BLANK_TEMPLATE ? null : next)}
          ariaLabel="Agent template"
          // ⚠ THE LAYOUT IS THIS FILE'S, exactly as the kit's docblock says: a template roster
          // has no width budget the kit can promise.
          className="flex-wrap"
        />

        <PillChoice
          label="Model"
          options={modelOptions}
          value={effectiveModel}
          onChange={panel.setModel}
          ariaLabel="Agent model"
          className="flex-wrap"
        />

        {/* ⚠ NO ROW WHERE THIS DESKTOP REPORTED NO RUNTIME — the no-dead-rows rule.
            ⚠ ONE REPORTED RUNTIME STILL RENDERS IT (Samuel, 2026-09-08): a single selected pill is
            how the operator SEES what their launch will run on.
            ⚠ EVERY REPORTED RUNTIME IS A LIVE, SELECTABLE PILL — unconnected ones wear the hint and
            nothing else, NOT `disabled`: a setup step, not a capability the platform lacks. */}
        {runtimes.length > 0 && (
          <PillChoice
            label="Runtime"
            options={runtimeOptions}
            value={selectedRuntime}
            onChange={setRuntime}
            ariaLabel="Agent runtime"
            className="flex-wrap"
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

        {/* ⚠ A REFUSAL IS SAID OUT LOUD HERE because nothing else will: main answering
            `{ok:false}` pushes nothing to explain the button that visibly did nothing. */}
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

      </FormDialog>

      {/* ⚠ A FOREIGN TEMPLATE'S FIRST RUN ON THIS MACHINE IS A QUESTION, NOT A FAILURE, and a
          SECOND dialog rather than a region inside this one: nesting another member's instructions
          in the form the operator is filling in is how untrusted text becomes Dopl's chrome. */}
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

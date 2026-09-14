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
 * is left here is this dialog's six rows and its launch lane.
 * ⚠ **THE SLIDE-OUT IS STILL IN THE TREE.** `composer-launch-panel.tsx` is unreferenced from the
 * Bot icon and keeps its own pins (`runtime-refusals.test.tsx`) until Samuel rules.
 * **Delete it when he does; do not let two launch forms live.**
 *
 * ⚠ **NOTHING ABOUT THE LAUNCH LANE CHANGED — the point of reusing {@link useLaunchRunner}.** The
 * act is still `use-agent-launch-run.ts › launchWithIdentity`. This file is a FACE: if a payload
 * assertion in `composer-launch.test.tsx` ever has to change for it, the change is wrong.
 *
 * ⚠ **THE SUBMIT MOVED BACK INSIDE THE FORM, SUPERSEDING THE 2026-08-27 RULING** that the panel
 * *"carries NO submit of its own — one control, context-labeled"*. That rule was about two submits
 * on ONE CARD; a dialog whose verb lived behind its own scrim would be unreachable. The composer's
 * control is plain "Send" while this is open — still exactly one Launch on screen.
 *
 * ── ⚠ **IT IS THE ONE LAUNCH FORM, AND `launch-sheet.tsx` IS DELETED (2026-09-13)** ──────────
 *
 * Samuel, over the old "Launch — Coder" sheet: *"the popup should essentially be the same as that
 * of a normal agent launch, except the template is pre-selected, and any options/descriptions …
 * instead of the popup saying New Agent, it should say New (name of template) Agent."* So a
 * template launch OPENS THIS DIALOG preselected (`use-agent-launch.ts › openWithTemplate`, from
 * `agent-templates/components/template-picker.tsx`) and the sheet's three jobs live here: its model
 * dropdown is the Model row, its read-only instructions disclosure is the **Instructions** field,
 * and its Cancel/Launch pair is the kit's footer. The heading is {@link title}.
 *
 * ⚠ **PREFILL IS THE PICK, NOT A SECOND SCREEN** (*"when a user clicks a template, all of those
 * fields would be pre-filled"*; *"the name prefilled and the user can change the name if they
 * want"*): `applyTemplate` fills Name, Description and Instructions and never overwrites a field
 * the operator edited. **Model is NOT prefilled and must not become so** — {@link effectiveModel}
 * DISPLAYS the template's model while `panel.model` stays `''`, which is what keeps main's
 * precedence chain the one authority.
 *
 * ⚠ **THE RUNTIME ROW SITS UNDER MODEL HERE.** The slide-out put it between Template and Model
 * because it *"decides what the two rows under it mean"*; Samuel's popup ordering is Name,
 * Description, **Instructions** (2026-09-13), Template, Model, Runtime — and **Colour** under that
 * (`agent-color-circles.tsx`, docs/specs/agent-colors.md item 7: *"At the bottom, under Runtime,
 * add multiple little circles"*), the only row whose data is the ROOM's rather than this
 * desktop's or this workspace's.
 *
 * ⚠ **NO "CHANNEL DEFAULT", AND THIS SPAWN'S RUNTIME IS ALWAYS ON THE WIRE (2026-09-08, Samuel).**
 * *"for runtime, there shouldn't be a channel default. I don't even know what the logic behind
 * that is, but can we unwire that? It should just be what the user is already connected to, right?
 * … Nobody knows what channel default is."* Options are the runtimes THIS DESKTOP REPORTED
 * (`use-channel-launch-posture.ts › runtimes`), and the selection is always sent. **One reported
 * runtime still RENDERS the row**, so the operator sees what will run.
 *
 * ⚠ **EVERY REPORTED RUNTIME IS AN OPTION, CONNECTED OR NOT, AND THE PRESELECT IS A FOUR-LINK
 * CHAIN** — both rules, Samuel's 2026-09-08 correction verbatim, and every link's argument live in
 * `launch-agent-dialog-runtime.ts`'s header ({@link runtimeRowOptions}, {@link pickRuntime}).
 * Stated there and not restated here: a rule written twice drifts in one of the copies.
 * Connectivity buys only (a) the muted **"not connected"** hint and (b) where the preselect lands;
 * an unconnected pill stays SELECTABLE, because it is a setup step rather than a missing
 * capability, and `acquire`'s spawn-time refusal explains the rest.
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
import { AgentColorCircles, agentColorsTaken } from "./agent-color-circles";
import { firstFreeAgentColor } from "../../lib/agent-colors";
import type { AgentColorKey } from "../../types";
import type { AgentLaunchControls } from "./use-agents-panel";
import type { AgentLaunchPanel } from "./use-agent-launch";
import { useLaunchRunner } from "./use-agent-launch-run";

/** The blank-agent option's key. ⚠ `""` because `SegmentedControl` is `<K extends string>`; it
 *  maps to `templateId: null` at the boundary, which is the wire's own spelling of "no
 *  template". Same sentinel `composer-launch-panel.tsx` uses, for the same reason. */
const BLANK_TEMPLATE = "";

/** ⚠ ONE OBJECT AT MODULE SCOPE for `EMPTY_RUNTIMES`' reason (`launch-agent-dialog-runtime.ts`):
 *  a fresh `[]` default would be a new identity every render and would rebuild the taken set on
 *  every keystroke in the Name field. */
const EMPTY_LIVE_SESSIONS: ReadonlyArray<never> = [];

export function LaunchAgentDialog({
  panel,
  newAgent,
  openThreadId,
  channelId,
  workspaceId,
  currentUserId,
  members,
  liveSessions = EMPTY_LIVE_SESSIONS,
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
   * None alone.
   */
  workspaceId: string | null;
  /** Whose templates wear NO marker — everyone else's wear one. */
  currentUserId: string;
  /** The CHANNEL roster, for the marker's name half. ⚠ Not the workspace's: a template shared
   *  by someone outside this channel degrades to "by another member" rather than losing its
   *  marker, because dropping it would turn UNKNOWN into MINE. */
  members: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }>;
  /**
   * **THE CHANNEL'S LIVE SESSIONS — PEER AND OWN — AND THE ONLY THING THE COLOUR ROW READS**
   * (2026-09-13; docs/specs/agent-colors.md item 7: *"The taken set comes from the channel's
   * live sessions projection (peer + own), refreshed by the same push the @-picker uses"*).
   *
   * ⚠ **ALL THREE MOUNTS PASS IT SINCE 2026-09-13, AND THEY PASS THREE DIFFERENT SOURCES** —
   * which is why the prop is a SHAPE. `agents-tab.tsx` hands the unfiltered channel projection
   * (`use-agents-panel.ts › peerSessions`); `composer.tsx` hands the peer ∪ own union its
   * @-picker already holds (`lib/live-agents.ts › liveAgentsKey`, ended rows already dropped, so
   * those rows carry no `state` — `agentColorsTaken` reads an absent one as LIVE); and
   * `agent-window-launch.tsx` hands the pop-out's own feed narrowed to the active tab's channel,
   * which is the ONLY source that window has (it reads no channel projection).
   * ⚠ **IT STAYS OPTIONAL AND EMPTY BY DEFAULT.** Empty means "nothing known to be taken", never
   * "nothing is taken": the server's partial unique index is the authority and answers 409 with
   * the free set (spec item 3), so an unwired caller offers every key and is corrected at launch
   * rather than rendering no row at all.
   * ⚠ Shaped as a STRUCTURAL SUBSET of `ChannelSessionState` rather than that type by name, so
   * the peer projection, the own-session feed and a test fixture all satisfy it without an
   * adapter — the same reason `agents-model.ts › agentLiveness` takes a shape.
   */
  liveSessions?: ReadonlyArray<{
    /** ⚠ ABSENT READS AS LIVE (`agent-color-circles.tsx › agentColorsTaken`) — the composer's
     *  union has already dropped every ended row, so it carries none. */
    state?: string | null;
    color?: AgentColorKey | null;
    name?: string | null;
    displayName?: string | null;
  }>;
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
      // ⚠ **THE WORD IS "None" SINCE 2026-09-13 AND IT IS SAMUEL'S** (*"when the user
      // clicks New Agent in the New Agent pop-up, I want you to change 'Blank Agent' to
      // 'None' for the template"*). The KEY is untouched — `BLANK_TEMPLATE` still maps to
      // `templateId: null`, so nothing on the wire moved with the label. ⚠ The OTHER
      // surfaces that still say "Blank agent" are the retired slide-out
      // (`composer-launch-panel.tsx`) and the template MENU
      // (`agent-templates/components/template-picker.tsx`); his ruling names this popup,
      // and neither file is this slice's.
      { key: BLANK_TEMPLATE, label: "None" },
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

  /**
   * THE SELECTED TEMPLATE'S ROW, or `null` for None — the TITLE's one input and the PREFILL's.
   *
   * ⚠ **IT RESOLVES OFF THE SAME LIST THE PILL ROW RENDERS**, so a template the roster has not
   * loaded yet (or one this operator may no longer see) leaves the title reading "New agent"
   * rather than naming a row this dialog cannot show. UNKNOWN is not a name.
   */
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === panel.templateId) ?? null,
    [templates, panel.templateId]
  );

  /**
   * **THE HEADING NAMES THE TEMPLATE** (Samuel, 2026-09-13: *"instead of the popup saying New
   * Agent, it should say New (name of template) Agent"*).
   *
   * ⚠ **LOWER CASE IN THE STRING, TITLE CASE ON SCREEN.** `standard-dialog.tsx › DIALOG_TITLE`
   * carries `capitalize`, so "New Coder agent" is rendered "New Coder Agent" and the ACCESSIBLE
   * NAME stays the string — `StandardDialog`'s own rule, and the reason a `.toUpperCase()` there
   * was refused: this value is `ModalShell`'s `aria-label` as well as its text.
   * ⚠ **"New agent" WHENEVER THERE IS NO TEMPLATE**, which includes None *and* a `templateId`
   * this roster cannot resolve — see {@link selectedTemplate}.
   */
  const title = selectedTemplate ? `New ${selectedTemplate.name} agent` : "New agent";

  /**
   * THE TEMPLATE ROW'S ONE HANDLER — **pick AND prefill, which is one act** (Samuel, 2026-09-13:
   * *"when a user clicks a template, all of those fields would be pre-filled"*). The three prefill
   * rules are `use-agent-launch.ts › applyTemplate`'s and are stated there.
   *
   * ⚠ **`setTemplateId` IS THE DEGRADATION, NOT A SECOND LANE.** A hand-built panel literal
   * carrying no `applyTemplate` (the two in the suites) still SELECTS a template and still launches
   * it — it simply prefills nothing, which is exactly what "this panel has no prefill" means.
   * ⚠ **AN ID THIS ROSTER CANNOT RESOLVE STILL SELECTS.** It cannot arrive from this row (the
   * options ARE the roster), but routing it through `applyTemplate(null)` would silently turn the
   * operator's pick into None — a selector that answers a different value than it was given.
   */
  const pickTemplate = (next: string) => {
    if (next === BLANK_TEMPLATE) {
      if (panel.applyTemplate) panel.applyTemplate(null);
      else panel.setTemplateId(null);
      return;
    }
    const picked = templates.find((t) => t.id === next) ?? null;
    if (picked && panel.applyTemplate) panel.applyTemplate(picked);
    else panel.setTemplateId(next);
  };

  /** WHICH KEYS THIS ROOM'S LIVE AGENTS HOLD — one derivation, in `agent-color-circles.tsx ›
   *  agentColorsTaken`, because the circles' fence and their tooltips have to be the same read. */
  const { taken, takenBy } = useMemo(() => agentColorsTaken(liveSessions), [liveSessions]);
  /**
   * WHAT THE COLOUR ROW SHOWS — the operator's own pick, else the FIRST FREE key.
   *
   * ⚠ **DISPLAY ONLY, EXACTLY LIKE {@link effectiveModel}, AND FOR THE SAME REASON SPELLED IN
   * THAT COMMENT.** `panel.color` stays `null` until a circle is clicked, so an untouched dialog
   * sends no `color` and the SERVER assigns the first free key — the authority that owns the
   * uniqueness index. Stamping this derived key into the panel would make a per-spawn statement
   * out of a room-level assignment, and on a mount whose `liveSessions` is still unwired it would
   * state `agent-01` at a room that may already hold it.
   * ⚠ `null` WHEN THE BANK IS EMPTY — sixteen live agents, no circle selected, and the launch is
   * still allowed (`lib/agent-colors.ts › firstFreeAgentColor` never refuses one).
   */
  const effectiveColor = useMemo<AgentColorKey | null>(
    () => panel.color ?? firstFreeAgentColor(taken),
    [panel.color, taken]
  );
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
        title={title}
        /* 🔒 **THE NAME IN {@link title} IS THE OPERATOR'S, SO THE CASING IS LEFT ALONE**
           (2026-09-14; `shared/ui/standard-dialog.tsx › DIALOG_TITLE_AS_TYPED`). The kit's
           default `capitalize` rewrites the first letter of EVERY word, so "New iOS Coder agent"
           rendered "New IOS Coder Agent" — the dialog misspelling the row it is about. Samuel's
           Title-Case ruling is about AUTHORED headings, so it stays the default and this is the
           opt-out; the trade is that the plain "New agent" keeps its lower-case a. The STRING is
           untouched either way: it is `ModalShell`'s `aria-label` too, so nothing cases it in JS. */
        titleCase={false}
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
        {/* ⚠ **UNDER DESCRIPTION, ONE LINE TALL, GROWING WITH THE TEXT** (Samuel, 2026-09-13:
            *"That should be a field under description, but don't make it like multiple lines as the
            default height. it will only increase in height if the user types more"*) —
            `minRows={1}` plus the kit's `field-sizing: content`
            (`shared/ui/form-dialog.module.css › .inputMultiline`), which is the same mechanism
            the Description field above it already uses. There is no measuring script.
            ⚠ **AND IT REPLACED THE LAUNCH SHEET'S READ-ONLY "Read" DISCLOSURE**, which is why that
            file is deleted: a launch could SHOW a template's instructions and not change them. */}
        <UnderlineField
          id="launch-agent-instructions"
          label="Instructions"
          multiline
          minRows={1}
          value={panel.instructions ?? ""}
          // ⚠ OPTIONAL FOR `AgentLaunchPanel.color`'s REASON (its docblock names the two hand-built
          // panel literals). Absent ⇒ the field is inert rather than a control that looks live.
          onChange={(next) => panel.setInstructions?.(next)}
          ariaLabel="Agent instructions"
        />

        <PillChoice
          label="Template"
          options={templateOptions}
          value={panel.templateId ?? BLANK_TEMPLATE}
          onChange={pickTemplate}
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

        {/* ⚠ **UNDER RUNTIME, WHICH IS WHERE SAMUEL PUT IT** (*"At the bottom, under Runtime, add
            multiple little circles that will act as the color switcher"*) — so it stays BELOW the
            row above even on a plain browser, where that row is not rendered at all.
            ⚠ **ALWAYS RENDERED, unlike Runtime**: the bank is this room's, not this desktop's, so
            there is no "nothing was reported" lane to hide it for. */}
        <AgentColorCircles
          value={effectiveColor}
          // ⚠ OPTIONAL FOR `AgentLaunchPanel.color`'s REASON (its docblock names the two hand-built
          // panel literals). Absent ⇒ this surface carries no colour, and the circles are inert
          // rather than a control that looks live and changes nothing.
          onChange={(next) => panel.setColor?.(next)}
          taken={taken}
          takenBy={takenBy}
        />

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

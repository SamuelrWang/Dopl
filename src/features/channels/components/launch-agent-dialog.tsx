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
 * Bot icon and keeps its own pins until Samuel rules. **Do not let two launch forms live.**
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
 * fields would be pre-filled"*): `applyTemplate` fills Name, Description and Instructions and
 * never overwrites a field the operator edited. **Model is NOT prefilled and must not become so**
 * — `launch-agent-dialog-model.ts › modelRowFor` DISPLAYS the template's model while `panel.model`
 * stays `''`, which is what keeps main's precedence chain the one authority; that file also
 * carries the rule for a template whose model belongs to ANOTHER runtime (it is not used and the
 * mismatch is said out loud, never translated).
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
 * CHAIN** — both rules and Samuel's 2026-09-08 correction live in
 * `launch-agent-dialog-runtime.ts`'s header; what the selected runtime then IMPLIES (the model
 * roster, the native summary, the sign-in sentence) lives in `launch-agent-dialog-state.ts`.
 * Stated there and not restated here: a rule written twice drifts in one of the copies.
 *
 * ⚠ **NOTHING IS REPORTED ⇒ NO ROW AND NO RUNTIME KEY** — a plain browser, and every desktop older
 * than the adapter port (`runtimeSupported` false). The only lane left where this popup sends no
 * runtime (INVARIANTS §11 — UNKNOWN is not EMPTY).
 * ⚠ **THE CHANNEL-LEVEL POSTURE ITSELF IS UNTOUCHED** — Settings still writes it and
 * `main/session-launch-op.js` still reads it for launches carrying no runtime (MCP's included).
 */

import { useMemo } from "react";
import { useAgentTemplates } from "@/features/agent-templates/hooks/use-agent-templates";
import { authorMarker } from "@/features/agent-templates/components/template-picker";
import { TemplateApprovalDialog } from "@/features/agent-templates/components/template-approval";
import { FormDialog, PillChoice, UnderlineField } from "@/shared/ui/form-dialog";
import { PLATFORM_DEFAULT_LABEL } from "./settings-agent-launch-rows";
import { useLaunchDialogRuntime } from "./launch-agent-dialog-state";
import { AgentColorCircles, agentColorsTaken } from "./agent-color-circles";
import { firstFreeAgentColor } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";
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
  // ⚠ **THE VERSIONED, RUNTIME-KEYED RECORD SINCE 2026-09-21 (U7), NOT THE LEGACY PAIR.** This
  // dialog has to answer "what does THIS runtime remember" for whichever pill is selected right
  // now, and the legacy `{tools, messages, model}` reply describes only the runtime the CHANNEL
  // picked. `hooks/use-launch-selection.ts` carries the whole argument.
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
   * **WHAT THE DESKTOP'S ANSWER MEANS FOR THIS DIALOG** — the roster, the preselect, the model
   * row, the native summary and the connection sentence, all derived from ONE selected runtime.
   *
   * ⚠ **ITS OWN FILE SINCE 2026-09-21 (U7)** — `launch-agent-dialog-state.ts`, past the §1 cap
   * and on a real seam: this file is the FORM (six rows, the identity fields, the launch lane),
   * that one is what the SELECTED RUNTIME implies. The two clocks came apart the moment a runtime
   * switch had to re-derive a roster, a remembered pick, a native summary and a refusal sentence
   * rather than just a label.
   */
  const runtime = useLaunchDialogRuntime(panel, channelId, templates);
  const {
    runtimes,
    selectedRuntime,
    runtimeOptions,
    modelRow,
    nativeLine,
    connectionNote,
    stopWarning,
  } = runtime;

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
          // ⚠ **NOTHING DISABLES THIS BUTTON ANY MORE (Samuel, 2026-09-15).** It read
          // `panel.ready ? "Launch" : "An agent needs a name"` — INVARIANTS §8 rule 4 — and the
          // condition is withdrawn: a blank name is a launch that is named `New Agent`.
          // ⚠ `disabled`/`panel.ready` STAY WIRED so the next real blocker has a door.
          hint: "Launch",
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

        {/* THE MODEL — THE SELECTED RUNTIME'S OWN ROSTER, AND NOBODY ELSE'S (2026-09-21, U7).
            ⚠ A ROSTER THAT IS NOT `ready` OFFERS NOTHING TO PICK and the row states the platform
            default instead: `loading` has not answered, `unavailable` measured a failure, and
            `stale` holds models it may still LABEL with but may not newly select. **It never
            falls back to another runtime's list** — that substitution is the one thing the whole
            unit exists to remove, and `model-catalog.ts › catalogFor` has no arm for it.
            ⚠ THE SENTENCE UNDER IT IS THE DESKTOP'S OWN WORDS, never Dopl's paraphrase. */}
        {modelRow.selectable ? (
          <PillChoice
            label="Model"
            options={modelRow.options}
            value={modelRow.shown}
            onChange={panel.setModel}
            ariaLabel="Agent model"
            className="flex-wrap"
          />
        ) : (
          <PillChoice
            label="Model"
            options={
              modelRow.shown
                ? [{ key: modelRow.shown, label: modelRow.options[0]?.label ?? modelRow.shown }]
                : [{ key: "", label: PLATFORM_DEFAULT_LABEL }]
            }
            value={modelRow.shown}
            // ⚠ NO WRITER, SO NO PICK — a single pill stating the fact. It is not `disabled`
            // chrome around a live control; there is one option and it is what will run.
            onChange={() => {}}
            ariaLabel="Agent model"
            className="flex-wrap"
          />
        )}
        {modelRow.reason && (
          <p role="note" className="text-caption text-text-secondary">
            {modelRow.reason}
          </p>
        )}
        {/* ⚠ **THE TEMPLATE'S MODEL BELONGS TO ANOTHER RUNTIME, SAID OUT LOUD** (U7: *"surface
            incompatibility instead of silently translating model IDs"*). The id is NOT used and
            NOT translated; without this line the operator would see the runtime's default under a
            template they picked for its model and have nothing to read about why. */}
        {modelRow.mismatch && (
          <p role="note" className="text-caption text-warning">
            {modelRow.mismatch.sentence}
          </p>
        )}

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
        {/* ⚠ WHAT THIS RUNTIME WILL ACTUALLY DO, in its own option labels — a REPORT of the
            channel's stored native values, never a control (see {@link nativeLine}). */}
        {nativeLine && (
          <p role="note" className="text-caption text-text-secondary">
            {nativeLine}
          </p>
        )}
        {/* ⚠ THE SELECTED RUNTIME'S OWN SIGN-IN SENTENCE — never Claude's, on any runtime. */}
        {connectionNote && (
          <p role="note" className="text-caption text-warning">
            {connectionNote}
          </p>
        )}
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

"use client";

/**
 * WHAT THE COMPOSER'S LAUNCH PANEL HOLDS — the identity a new agent is about to wear, and the
 * three-step act of giving it one (2026-08-27, Samuel's launch-panel ruling).
 *
 * ⚠ IT REPLACED THE TEMPLATE CHEVRON. The Bot icon used to launch a blank agent in one click
 * with a second glyph beside it opening a template menu; the panel is now the whole surface, and
 * `Launch` is its one submit. Samuel's *one lane, one-click launch* ruling is not violated —
 * there is still exactly ONE launch lane and one control that starts it, and the panel is where
 * the click happens.
 *
 * ── THE ID IS ASSIGNED BEFORE THE SPAWN, AND THAT IS THE WHOLE REASON THIS FILE IS INTERESTING.
 *
 * `main/agent-id.js › newAgentId` is a CSPRNG draw and the id has always been minted inside main
 * at spawn, so a panel that wanted to SHOW the operator their agent's address had nothing true
 * to show. The chain that makes it true now:
 *
 *   1. `sessions.mintAgentId()`      — main draws one and hands it over; reserves nothing
 *   2. the panel renders it, and `launch` carries it back as `agentId`
 *   3. `main/session-launch-op.js`   — forwards it (this was the gap; pinned by
 *                                      `dopl-desktop-app/test/launch-agent-id.test.mjs`)
 *   4. `main/session-launch.js`      — honours it (`isAgentId(a.agentId) ? … : newAgentId()`)
 *
 * ⚠ THE GATE IS STEP 1'S OP, NOT ANYTHING IN THE LAUNCH REPLY, and there is no other honest
 * choice. A desktop older than step 3 still has `launch`, still ACCEPTS the field, and silently
 * mints its own id — so detecting `launch` proves nothing and the failure is invisible from
 * here. {@link canPreassignAgentId} detects the op that shipped WITH the forward (INVARIANTS
 * §11: detect the member you are about to use), and with it absent the panel shows no id until
 * main answers with one. **An address the agent does not have is worse than an address that
 * arrives late** — the operator `@`-mentions this string, and a wrong one reaches nobody.
 *
 * ⚠ AND THE REPLY STILL WINS. `outcome.agentId` is main's own answer and is what the panel
 * paints when the launch settles, whatever was pre-assigned — the same never-echo rule
 * `rename` / `setMode` / `setModel` follow. On a current build the two agree; on an old one they
 * do not, and the honest value is main's.
 *
 * ── NAME AND DESCRIPTION ARE WRITTEN AFTER THE SPAWN, DELIBERATELY.
 *
 * Both are agent METADATA in `main/agent-names.js`, keyed by the instance address — so neither
 * can be written until an agent exists to key them to. ⚠ THEY ARE NOT PART OF THE LAUNCH
 * PAYLOAD AND MUST NOT BECOME PART OF IT: the launch is SPAWN-IDLE (ruling 3, pinned in
 * `test/launch-agent-id.test.mjs`), and the obvious wrong wiring for a description — sending it
 * as the agent's first message — would wake every launched agent and retire that ruling by
 * accident. A description says what the agent is FOR; it is not a turn.
 *
 * ⚠ A FAILED RENAME OR DESCRIBE DOES NOT FAIL THE LAUNCH, and is not silent either. The agent is
 * already running by then; reporting "launch failed" would be a lie about the thing that
 * mattered. The refusal is surfaced on its own line instead.
 *
 * ⚠ FEATURE-DETECTED AT THE CALL SITE, on the bridge member about to be used — never on a
 * wrapper exported from here, which is always a function and would answer `true` in a plain
 * browser (`agents-controls.ts` carries the bug that earned this rule). `agent-rename.tsx`
 * reaches `sessions.rename` the same way, which is the precedent these two follow.
 */

import { useCallback, useRef, useState } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import type { AgentColorKey } from "../../types";
import { AGENT_MODEL_DEFAULT } from "../../lib/agent-models";

/**
 * Whether this build honours a pre-assigned instance id.
 *
 * ⚠ IT DETECTS `sessions.mintAgentId`, WHICH IS NOT THE OP BEING GATED, and that is deliberate
 * rather than sloppy: the thing being gated (`launchFromButton`'s forward) has no observable
 * surface of its own, and the mint op shipped in the same change. ⚠ DO NOT WIDEN IT TO
 * `sessions.launch` — every build has that, including every build that drops the field.
 */
export function canPreassignAgentId(): boolean {
  return typeof getSpaBridge()?.sessions?.mintAgentId === "function";
}

/** One fresh instance id from main, or `null` when this build cannot mint one. */
export async function mintAgentId(): Promise<string | null> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.mintAgentId !== "function") return null;
  const res = await sessions.mintAgentId();
  // ⚠ TOLERANT: an id came back ⇒ we have one, whatever else the object carries. Same
  // two-success-shapes discipline `launchAgentOnThread` applies to its own reply.
  return typeof res?.agentId === "string" && res.agentId ? res.agentId : null;
}

/** Store what the operator calls this agent. `''` clears it. ⚠ EXPORTED for
 *  `use-agent-launch-run.ts` alone — the ACT half of the §1 split, which is the only caller. */
export async function renameAgent(agentId: string, name: string): Promise<boolean> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.rename !== "function") return false;
  return (await sessions.rename(agentId, name))?.ok === true;
}

/** Store what the operator says this agent is FOR. `''` clears it. ⚠ EXPORTED for
 *  `use-agent-launch-run.ts` alone, like {@link renameAgent}. */
export async function describeAgent(agentId: string, description: string): Promise<boolean> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.describe !== "function") return false;
  return (await sessions.describe(agentId, description))?.ok === true;
}

/** The canonical name an unnamed agent wears — `agents-model.ts › agentDisplayName`'s shape.
 *  ⚠ `#<id>` since 2026-08-31 (Samuel's ruling): the word "agent" moved out of the NAME and
 *  into the grey chip (`attribution-pill.tsx › AgentChip`); the two must not both say it. */
export function defaultAgentName(agentId: string | null): string {
  return agentId ? `#${agentId}` : "";
}

/**
 * WHAT A TEMPLATE HANDS THE POPUP WHEN IT IS PICKED (2026-09-13, Samuel: *"when a user clicks a
 * template, all of those fields would be pre-filled"*).
 *
 * ⚠ **A SHAPE, NOT `AgentTemplate` BY NAME**, exactly as `agents-model.ts › agentLiveness` takes
 * one: this hook is `features/channels`' and the type is `features/agent-templates`'. The popup
 * already imports that feature's HOOK, so an import would resolve — but a structural subset is
 * what lets the picker, the pill row and a test fixture all satisfy it without an adapter, and it
 * keeps this file honest about the four fields it actually reads.
 * ⚠ **NO `fields` AND NO KNOWLEDGE.** Those ride the TEMPLATE ID on the wire — main resolves the
 * row at spawn (`main/session-launch-op.js`) — so a copy here would be a second, staler account
 * of the same configuration. What is prefilled is what the operator can SEE and CHANGE.
 */
export interface AgentTemplatePrefill {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
}

export interface AgentLaunchPanel {
  open: boolean;
  /** The pre-assigned address, or `null` on a build that cannot pre-assign. */
  agentId: string | null;
  name: string;
  description: string;
  /**
   * WHAT THIS RUN IS TOLD TO DO — the template's instructions, editable per spawn (Samuel,
   * 2026-09-13: *"we should add an Instructions field in the New agent popup. That should be a
   * field under description"*).
   *
   * ⚠ **IT REPLACED THE LAUNCH SHEET'S READ-ONLY "Read" DISCLOSURE**, which is the ruling that
   * deleted that file: a launch had a place to SHOW instructions and no place to change them, and
   * Samuel asked for the field rather than the disclosure.
   * ⚠ **OPTIONAL FOR {@link AgentLaunchPanel.color}'s REASON** — the two hand-built panel
   * literals (`runtime-refusals.test.tsx › panelStub`, `launch-agent-dialog.test.tsx ›
   * oldPanelState`) are not this hook, and absent reads as "this panel carries no instructions",
   * which is what those surfaces mean.
   */
  instructions?: string;
  setInstructions?: (next: string) => void;
  /**
   * THE TEXT {@link AgentLaunchPanel.applyTemplate} LAST WROTE INTO `instructions` — the BASELINE
   * the wire is measured against, never a second copy of the value.
   *
   * ⚠ **IT IS WHY A TEMPLATE LAUNCH SENDS NO `instructions` OVERRIDE UNLESS THE OPERATOR TYPED
   * ONE.** `launch-overrides.ts › overridesFor`'s rule — *a pick equal to the template's own is
   * not an override* — applied to a third field: sending the template's own prose back to main
   * would be a payload that only LOOKS like a decision, and it would go stale the moment the
   * template was edited between this dialog opening and Launch being pressed.
   */
  instructionsBaseline?: string;
  /** `null` is a BLANK agent — the template selector's first option. */
  templateId: string | null;
  /** `AGENT_MODEL_DEFAULT` (`""`) is "whatever the chain decides". */
  model: string;
  /**
   * THIS SPAWN'S RUNTIME, or `''` for "the channel's own pick" (2026-08-31).
   *
   * ⚠ `''` IS NOT "THE DEFAULT ADAPTER" HERE, and that is the one place this
   * field's empty string means something different from the Settings row's. On
   * the DURABLE record `''` sets the channel back to the default; on a LAUNCH it
   * means the operator expressed no per-spawn preference, so the channel's pick
   * stands. `use-agents-panel.ts › launchAgent` therefore omits the key rather
   * than sending `''`.
   */
  runtime: string;
  /**
   * THIS SPAWN'S COLOUR IN THIS CHANNEL, or `null` for "let the server pick the first
   * free key" (Samuel, 2026-09-13; docs/specs/agent-colors.md item 7).
   *
   * ⚠ **`null` IS NOT "NO COLOUR" — IT IS "NOBODY CHOSE", and the two must not merge.**
   * The circles row SHOWS the first free key from the moment it opens
   * (`launch-agent-dialog.tsx › effectiveColor`), but this field stays `null` until the
   * operator clicks one, so an untouched dialog omits `color` from the payload and the
   * server's own first-free assignment stands. **That is the Model row's ruling applied
   * to a second field**: a row that wrote its displayed default into the panel would turn
   * the server's assignment into a per-spawn pick that then stops following it — and with
   * the taken set unwired on a surface, that pick would be a key the room may already
   * hold.
   *
   * ⚠ **OPTIONAL, LIKE `ChannelSessionState.color` AND FOR THE SAME REASON.** Adding a
   * REQUIRED member here breaks every hand-built panel literal that is not this hook —
   * `runtime-refusals.test.tsx › panelStub` and `launch-agent-dialog.test.tsx ›
   * oldPanelState` are the two — so the addition is genuinely ADDITIVE: absent reads as
   * "this panel does not carry a colour", which is exactly what those two surfaces mean.
   */
  color?: AgentColorKey | null;
  /** ⚠ OPTIONAL for {@link AgentLaunchPanel.color}'s reason, and consumed as
   *  `panel.setColor?.(…)`. The hook always supplies it. */
  setColor?: (next: AgentColorKey) => void;
  /** A name is the only required field; a blank agent with no description is legitimate. */
  ready: boolean;
  /** A rename/describe that main refused AFTER the agent started. Never a launch failure. */
  identityError: string | null;
  setIdentityError: (next: string | null) => void;
  setName: (next: string) => void;
  setDescription: (next: string) => void;
  setTemplateId: (next: string | null) => void;
  setModel: (next: string) => void;
  setRuntime: (next: string) => void;
  /**
   * PICK A TEMPLATE **AND PREFILL WHAT IT CARRIES** — one act, because Samuel's ruling is that
   * the two happen together: *"when a user clicks a template, all of those fields would be
   * pre-filled."*
   *
   * ⚠ **`null` IS "None" AND IT PREFILLS NOTHING.** Clearing the template keeps whatever the
   * operator typed — a field they can see is theirs, and blanking three of them because a
   * selector went back to its first option is data loss with no undo.
   * ⚠ **IT NEVER OVERWRITES A FIELD THE OPERATOR HAS EDITED**, which is the only rule under
   * which *"the name field … an individual agent from that template might have a different name
   * the user might want to set"* and *"all of those fields would be pre-filled"* are both true.
   * The test is per field and it is EDITED-SINCE-THE-LAST-PREFILL, not "non-empty": the Name
   * arrives already holding the mint's `#<id>`, so a non-empty test would never prefill it at all.
   * ⚠ **MODEL IS DELIBERATELY NOT IN THE SET.** `launch-agent-dialog.tsx › effectiveModel`
   * already DISPLAYS the template's model, and `panel.model` staying `''` is what keeps the
   * precedence chain in main (`session-launch-op.js`) the one authority — stamping the template's
   * id here would turn a default into a per-spawn pick that then stops following the template.
   * ⚠ OPTIONAL for {@link AgentLaunchPanel.color}'s reason; the hook always supplies it.
   */
  applyTemplate?: (template: AgentTemplatePrefill | null) => void;
  /**
   * OPEN THE POPUP ALREADY HOLDING A TEMPLATE — the ONE entry point a "launch from a template"
   * affordance uses (2026-09-13; INVARIANTS §5A: one launch surface).
   *
   * ⚠ **NOT {@link AgentLaunchPanel.toggle}**: a toggle called while the form is open CLOSES it,
   * so a second template click would dismiss the dialog it was meant to re-point. This opens if
   * shut, applies either way, and mints on exactly the same terms `toggle` does.
   */
  openWithTemplate?: (template: AgentTemplatePrefill | null) => void;
  toggle: () => void;
  close: () => void;
  reset: () => void;
}

export function useAgentLaunch(): AgentLaunchPanel {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [name, setNameState] = useState("");
  const [description, setDescriptionState] = useState("");
  const [instructions, setInstructionsState] = useState("");
  const [instructionsBaseline, setInstructionsBaseline] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [model, setModel] = useState<string>(AGENT_MODEL_DEFAULT);
  // ⚠ `""` = follow the channel's pick, NOT "the default adapter" — see the
  // field's docblock on `AgentLaunchPanel`.
  const [runtime, setRuntime] = useState<string>("");
  // ⚠ `null` = the operator touched no circle, so the payload omits `color` and the
  // server assigns the first free key — see the field's docblock on `AgentLaunchPanel`.
  const [color, setColor] = useState<AgentColorKey | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  /**
   * WHICH OF THE THREE TEXT FIELDS THE OPERATOR HAS TOUCHED — a REF, because nothing renders off
   * it and a state update per keystroke would re-render the whole dialog to record a fact only
   * {@link applyTemplate} ever asks about.
   *
   * ⚠ **THE MINT'S NAME PREFILL MUST NOT SET IT**, which is why the three public setters are
   * wrappers and the hook's own writes go to the raw `useState` setters. The mint writes
   * `#<agentId>`; if that counted as the operator typing, a template pick would never fill the
   * Name in — the single case the whole prefill exists for.
   */
  const touched = useRef({ name: false, description: false, instructions: false });

  const setName = useCallback((next: string) => {
    touched.current.name = true;
    setNameState(next);
  }, []);
  const setDescription = useCallback((next: string) => {
    touched.current.description = true;
    setDescriptionState(next);
  }, []);
  const setInstructions = useCallback((next: string) => {
    touched.current.instructions = true;
    setInstructionsState(next);
  }, []);

  const reset = useCallback(() => {
    setOpen(false);
    setAgentId(null);
    setNameState("");
    setDescriptionState("");
    setInstructionsState("");
    setInstructionsBaseline("");
    // ⚠ CLEARED WITH THE VALUES. A reopened dialog is a fresh form, so every field is prefillable
    // again — leaving these `true` would make the next template pick fill in nothing.
    touched.current = { name: false, description: false, instructions: false };
    setTemplateId(null);
    setModel(AGENT_MODEL_DEFAULT);
    setRuntime("");
    // ⚠ CLEARED WITH THE REST, so a dialog reopened after the room's colours moved
    // re-derives its first-free default instead of holding a key somebody now owns.
    setColor(null);
    setIdentityError(null);
  }, []);

  /**
   * Opening MINTS EXACTLY ONCE, and that one draw is both the forwarded id and the Name prefill.
   *
   * ⚠ THE MINT MUST NOT LIVE INSIDE THE `setOpen` UPDATER, AND THIS IS THE BUG THAT PROVED IT
   * (Samuel, 2026-08-27, from a screenshot reading Name `Agent #k3wpf7c5` over ID `uyxw3rdv`).
   * A state updater must be PURE: React invokes it more than once — twice under StrictMode, and
   * again whenever an update is rebased — so a `mintAgentId()` call inside it fired TWICE and drew
   * TWO ids. The second `setAgentId` won the ID, while the prefill guard (`typed === ""`) was
   * already false by then and kept the FIRST id's name. **Two draws, and the panel showed one of
   * each.** The forwarded id was the second, so the name the operator read was never that agent's.
   * ⚠ SO THE TOGGLE BRANCHES ON `open` AND THE EFFECT SITS OUTSIDE. `open` is in the dependency
   * list rather than read through an updater — the cost is one identity change per toggle, which
   * is nothing, and the property bought is that the side effect runs once per click.
   *
   * ⚠ THE PANEL OPENS FIRST AND FILLS THE ID IN. It is one IPC round trip on the operator's own
   * machine, but the panel must not wait on it to appear.
   * ⚠ A MINT THAT ANSWERS NULL IS NOT AN ERROR. It is an older desktop, or a plain browser, and
   * the panel simply carries no pre-assigned id — the launch reply supplies one.
   *
   * ⚠ **THE OPEN LANE IS ITS OWN CALLBACK SINCE 2026-09-13** so `openWithTemplate` reaches it
   * without going through `toggle` (which would CLOSE an open dialog). One mint site, one set of
   * rules above it; a second copy is how the two-draw bug comes back on the other opener.
   */
  const openPanel = useCallback(() => {
    setOpen(true);
    setIdentityError(null);
    void mintAgentId().then((minted) => {
      if (!minted) return;
      setAgentId(minted);
      // ⚠ THE NAME AND THE ID COME FROM THE SAME `minted`, IN ONE STATEMENT. Deriving the
      // prefill from a second read of `agentId` would reintroduce the split above by another
      // road: that state is not yet committed here.
      // ⚠ AND IT IS THE RAW SETTER, so the prefill does not count as the operator typing —
      // `touched` is what a template pick consults before filling this field in.
      setNameState((typed) => (typed === "" ? defaultAgentName(minted) : typed));
    });
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    openPanel();
  }, [open, openPanel]);

  /**
   * PICK A TEMPLATE AND FILL IN WHAT IT CARRIES — see {@link AgentLaunchPanel.applyTemplate} for
   * the ruling and the three rules (None prefills nothing, an edited field is never overwritten,
   * Model is not in the set).
   *
   * ⚠ **FUNCTIONAL UPDATES, NOT A READ OF `name` / `description` / `instructions`.** This callback
   * must stay stable across every keystroke — `openWithTemplate` depends on it and the dialog
   * hands it to a `SegmentedControl` — and closing over those three values would rebuild it about
   * as often as the operator types.
   */
  const applyTemplate = useCallback((template: AgentTemplatePrefill | null) => {
    setTemplateId(template?.id ?? null);
    if (!template) return;
    const nextInstructions = template.instructions ?? "";
    if (!touched.current.name) setNameState(template.name);
    if (!touched.current.description) setDescriptionState(template.description ?? "");
    if (!touched.current.instructions) setInstructionsState(nextInstructions);
    // ⚠ THE BASELINE MOVES WITH THE TEMPLATE EVEN WHERE THE FIELD DID NOT. It is what the wire is
    // measured against, and an operator who has typed their own prose is measured against the
    // template they are now launching — not against one they clicked past.
    setInstructionsBaseline(nextInstructions);
  }, []);

  const openWithTemplate = useCallback(
    (template: AgentTemplatePrefill | null) => {
      // ⚠ OPEN FIRST, APPLY SECOND, AND NEVER `toggle`: see the field's docblock. Both are state
      // updates in one handler, so React batches them and the mint's own `typed === ""` guard
      // sees the prefilled name rather than racing it.
      if (!open) openPanel();
      applyTemplate(template);
    },
    [open, openPanel, applyTemplate]
  );

  return {
    open,
    agentId,
    name,
    description,
    instructions,
    instructionsBaseline,
    templateId,
    model,
    runtime,
    color,
    setColor,
    // ⚠ THE NAME IS THE ONLY GATE. A blank agent is a real configuration (no template), so is a
    // model of "Default", and so is an agent with no description — none of those may block a
    // launch. An unnamed one is refused only because the field is prefilled: an empty one means
    // the operator deliberately cleared it, and `Agent #<id>` is what they would get anyway.
    ready: name.trim().length > 0,
    identityError,
    setIdentityError,
    setName,
    setDescription,
    setInstructions,
    setTemplateId,
    setModel,
    setRuntime,
    applyTemplate,
    openWithTemplate,
    toggle,
    close: () => setOpen(false),
    reset,
  };
}

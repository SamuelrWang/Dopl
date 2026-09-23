"use client";

/**
 * WHAT THE COMPOSER'S LAUNCH PANEL HOLDS — the identity a new agent is about to wear, and the
 * three-step act of giving it one (2026-08-27, Samuel's launch-panel ruling).
 *
 * ⚠ IT REPLACED THE IDENTITY CHEVRON. The Bot icon used to launch a blank agent in one click
 * with a second glyph beside it opening an identity menu; the panel is now the whole surface, and
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
import type { AgentColorKey } from "../types";
import { AGENT_MODEL_DEFAULT } from "../lib/agent-models";

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

// ⚠ **`defaultAgentName` IS DELETED (Samuel, 2026-09-15, verbatim: *"for new agents, right now
// it auto fills the name with the ID. The name should be blank"*).** It answered `#<agentId>`
// and {@link openPanel} wrote it into the Name field the instant the mint came back, so every
// launch dialog opened showing the operator eight machine characters where their own words go.
// ⚠ **AND IT WAS THE ARGUMENT THAT KEPT THE ID ON EVERY OTHER SURFACE.** INVARIANTS §11 defended
// the `#<id>` FACE as *"a NAME the operator was shown at launch and accepted"* — a defence whose
// entire evidence was this prefill. Removing the prefill removes the defence; the face is
// `shared/lib/agent-name.ts › NEW_AGENT_NAME` now.
// ⚠ **NOTHING REPLACES IT AS A FUNCTION.** Its second reader
// (`use-agent-launch-run.ts › launchWithIdentity`) compared the typed name against it to decide
// "this is the prefill, not a rename"; with a blank field that question IS `wanted === ""`, and
// a helper for the empty string is a helper for nothing.

/**
 * WHAT AN IDENTITY HANDS THE POPUP WHEN IT IS PICKED (2026-09-13, Samuel: *"when a user clicks a
 * identity, all of those fields would be pre-filled"*).
 *
 * ⚠ **A SHAPE, NOT `AgentIdentity` BY NAME**, exactly as `agents-model.ts › agentLiveness` takes
 * one: this hook is `features/channels`' and the type is `features/agent-identities`'. The popup
 * already imports that feature's HOOK, so an import would resolve — but a structural subset is
 * what lets the picker, the pill row and a test fixture all satisfy it without an adapter, and it
 * keeps this file honest about the four fields it actually reads.
 * ⚠ **NO `fields` AND NO KNOWLEDGE.** Those ride the IDENTITY ID on the wire — main resolves the
 * row at spawn (`main/session-launch-op.js`) — so a copy here would be a second, staler account
 * of the same configuration. What is prefilled is what the operator can SEE and CHANGE.
 */
export interface AgentIdentityPrefill {
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
   * WHAT THIS RUN IS TOLD TO DO — the identity's instructions, editable per spawn (Samuel,
   * 2026-09-13: *"we should add an Instructions field in the New agent popup. That should be a
   * field under description"*).
   *
   * ⚠ **IT REPLACED THE LAUNCH SHEET'S READ-ONLY "Read" DISCLOSURE**, which is the ruling that
   * deleted that file: a launch had a place to SHOW instructions and no place to change them, and
   * Samuel asked for the field rather than the disclosure.
   * ⚠ **OPTIONAL FOR {@link AgentLaunchPanel.color}'s REASON** — the hand-built panel literal
   * (`launch-agent-dialog.test.tsx › oldPanelState`) is not this hook, and absent reads as "this
   * panel carries no instructions".
   */
  instructions?: string;
  setInstructions?: (next: string) => void;
  /**
   * THE TEXT {@link AgentLaunchPanel.applyIdentity} LAST WROTE INTO `instructions` — the BASELINE
   * the wire is measured against, never a second copy of the value.
   *
   * ⚠ **IT IS WHY AN IDENTITY LAUNCH SENDS NO `instructions` OVERRIDE UNLESS THE OPERATOR TYPED
   * ONE.** `launch-overrides.ts › overridesFor`'s rule — *a pick equal to the identity's own is
   * not an override* — applied to a third field: sending the identity's own prose back to main
   * would be a payload that only LOOKS like a decision, and it would go stale the moment the
   * identity was edited between this dialog opening and Launch being pressed.
   */
  instructionsBaseline?: string;
  /** `null` is a BLANK agent — the identity selector's first option. */
  identityId: string | null;
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
   * REQUIRED member here breaks every hand-built panel literal that is not this hook
   * (`launch-agent-dialog.test.tsx › oldPanelState`), so the addition is genuinely ADDITIVE:
   * absent reads as "this panel does not carry a colour".
   */
  color?: AgentColorKey | null;
  /** ⚠ OPTIONAL for {@link AgentLaunchPanel.color}'s reason, and consumed as
   *  `panel.setColor?.(…)`. The hook always supplies it. */
  setColor?: (next: AgentColorKey) => void;
  /** A rename/describe that main refused AFTER the agent started. Never a launch failure. */
  identityError: string | null;
  setIdentityError: (next: string | null) => void;
  setName: (next: string) => void;
  setDescription: (next: string) => void;
  setIdentityId: (next: string | null) => void;
  setModel: (next: string) => void;
  setRuntime: (next: string) => void;
  /**
   * PICK AN IDENTITY **AND PREFILL WHAT IT CARRIES** — one act, because Samuel's ruling is that
   * the two happen together: *"when a user clicks an identity, all of those fields would be
   * pre-filled."*
   *
   * ⚠ **`null` IS "None" AND IT PREFILLS NOTHING.** Clearing the identity keeps whatever the
   * operator typed — a field they can see is theirs, and blanking three of them because a
   * selector went back to its first option is data loss with no undo.
   * ⚠ **IT NEVER OVERWRITES A FIELD THE OPERATOR HAS EDITED**, which is the only rule under
   * which *"the name field … an individual agent from that identity might have a different name
   * the user might want to set"* and *"all of those fields would be pre-filled"* are both true.
   * The test is per field and it is EDITED-SINCE-THE-LAST-PREFILL, not "non-empty": the Name
   * arrives already holding the mint's `#<id>`, so a non-empty test would never prefill it at all.
   * ⚠ **MODEL IS DELIBERATELY NOT IN THE SET.** `launch-agent-dialog.tsx › effectiveModel`
   * already DISPLAYS the identity's model, and `panel.model` staying `''` is what keeps the
   * precedence chain in main (`session-launch-op.js`) the one authority — stamping the identity's
   * id here would turn a default into a per-spawn pick that then stops following the identity.
   * ⚠ OPTIONAL for {@link AgentLaunchPanel.color}'s reason; the hook always supplies it.
   */
  applyIdentity?: (identity: AgentIdentityPrefill | null) => void;
  /**
   * OPEN THE POPUP ALREADY HOLDING AN IDENTITY — the ONE entry point a "launch from an identity"
   * affordance uses (2026-09-13; INVARIANTS §5A: one launch surface).
   *
   * ⚠ **NOT {@link AgentLaunchPanel.toggle}**: a toggle called while the form is open CLOSES it,
   * so a second identity click would dismiss the dialog it was meant to re-point. This opens if
   * shut, applies either way, and mints on exactly the same terms `toggle` does.
   */
  openWithIdentity?: (identity: AgentIdentityPrefill | null) => void;
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
  const [identityId, setIdentityId] = useState<string | null>(null);
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
   * {@link applyIdentity} ever asks about.
   *
   * ⚠ **THE MINT'S NAME PREFILL MUST NOT SET IT**, which is why the three public setters are
   * wrappers and the hook's own writes go to the raw `useState` setters. The mint writes
   * `#<agentId>`; if that counted as the operator typing, an identity pick would never fill the
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
    // again — leaving these `true` would make the next identity pick fill in nothing.
    touched.current = { name: false, description: false, instructions: false };
    setIdentityId(null);
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
   * ⚠ **THE OPEN LANE IS ITS OWN CALLBACK SINCE 2026-09-13** so `openWithIdentity` reaches it
   * without going through `toggle` (which would CLOSE an open dialog). One mint site, one set of
   * rules above it; a second copy is how the two-draw bug comes back on the other opener.
   */
  const openPanel = useCallback(() => {
    setOpen(true);
    setIdentityError(null);
    void mintAgentId().then((minted) => {
      if (!minted) return;
      setAgentId(minted);
      // ⚠ **THE NAME IS NOT PREFILLED (Samuel, 2026-09-15: *"The name should be blank"*).** This
      // line read `setNameState((typed) => (typed === "" ? defaultAgentName(minted) : typed))`,
      // which put `#<id>` in front of the operator before they had typed anything — and made
      // the id look like a name the product had chosen, which is what let it spread to every
      // other surface. **The mint still happens and the id is still forwarded**: it is the
      // ADDRESS the launch returns and the third coordinate of every session op. What changed is
      // that it is no longer SHOWN.
      // ⚠ **A BLANK SUBMIT IS NOT A NAMELESS AGENT** — `use-agent-launch-run.ts` names it
      // `New Agent` on the way out, which is the rest of the same sentence.
    });
  }, []);

  /**
   * 🔒 **CLOSING IS DISCARDING, BY WHICHEVER OF THE THREE EXITS (2026-09-14 ruling).**
   *
   * ⚠ **THE BUG WAS THAT THE FORM HAD TWO KINDS OF CLOSE AND LOOKED LIKE ONE.** Escape and the
   * backdrop went through {@link reset} (`launch-agent-dialog.tsx › discard`), while the Bot
   * icon and the pop-out's `+` — the SAME control that opened it — went through a bare
   * `setOpen(false)`. So a dialog dismissed by its own button kept the name, the description,
   * the instructions, the identity, the instructions BASELINE and the `touched` flags, and
   * reopening then MINTED A SECOND AGENT ID underneath the first one's typed name: the panel
   * showed one agent's address over another's name, which is the 2026-08-27 two-draw bug
   * arriving by a different road. It also meant an identity pick after such a reopen prefilled
   * nothing, because `touched` still said the operator had typed.
   *
   * ⚠ **SO `toggle`, `close` AND THE DIALOG'S DISCARD ARE ONE PATH**, and it is {@link reset}.
   * A form that remembers a decision the operator undid has no way to say so on screen.
   */
  const toggle = useCallback(() => {
    if (open) {
      reset();
      return;
    }
    openPanel();
  }, [open, openPanel, reset]);

  /**
   * PICK AN IDENTITY AND FILL IN WHAT IT CARRIES — see {@link AgentLaunchPanel.applyIdentity} for
   * the ruling and the three rules (None prefills nothing, an edited field is never overwritten,
   * Model is not in the set).
   *
   * ⚠ **FUNCTIONAL UPDATES, NOT A READ OF `name` / `description` / `instructions`.** This callback
   * must stay stable across every keystroke — `openWithIdentity` depends on it and the dialog
   * hands it to a `SegmentedControl` — and closing over those three values would rebuild it about
   * as often as the operator types.
   */
  const applyIdentity = useCallback((identity: AgentIdentityPrefill | null) => {
    setIdentityId(identity?.id ?? null);
    if (!identity) return;
    const nextInstructions = identity.instructions ?? "";
    if (!touched.current.name) setNameState(identity.name);
    if (!touched.current.description) setDescriptionState(identity.description ?? "");
    if (!touched.current.instructions) setInstructionsState(nextInstructions);
    // ⚠ THE BASELINE MOVES WITH THE IDENTITY EVEN WHERE THE FIELD DID NOT. It is what the wire is
    // measured against, and an operator who has typed their own prose is measured against the
    // identity they are now launching — not against one they clicked past.
    setInstructionsBaseline(nextInstructions);
  }, []);

  const openWithIdentity = useCallback(
    (identity: AgentIdentityPrefill | null) => {
      // ⚠ OPEN FIRST, APPLY SECOND, AND NEVER `toggle`: see the field's docblock. Both are state
      // updates in one handler, so React batches them and the mint's own `typed === ""` guard
      // sees the prefilled name rather than racing it.
      if (!open) openPanel();
      applyIdentity(identity);
    },
    [open, openPanel, applyIdentity]
  );

  return {
    open,
    agentId,
    name,
    description,
    instructions,
    instructionsBaseline,
    identityId,
    model,
    runtime,
    color,
    setColor,
    identityError,
    setIdentityError,
    setName,
    setDescription,
    setInstructions,
    setIdentityId,
    setModel,
    setRuntime,
    applyIdentity,
    openWithIdentity,
    toggle,
    // ⚠ **`reset`, NOT `setOpen(false)` — ONE CLOSE PATH** (see {@link toggle}). Its one caller
    // is `composer.tsx › onNewThread`, on its way to the thread popup: two forms may not stand
    // at once, and leaving a half-typed agent identity behind a form the operator navigated away
    // from is the same remembered-undone-decision this hook now refuses everywhere else.
    close: reset,
    reset,
  };
}

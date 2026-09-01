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

import { useCallback, useState } from "react";
import type { TemplateApprovalRequest } from "@/features/agent-templates/components/template-approval";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import { AGENT_MODEL_DEFAULT } from "../../lib/agent-models";
import { LAUNCH_APPROVAL_REASON, type AgentLaunchControls } from "./use-agents-panel";

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

/** Store what the operator calls this agent. `''` clears it. */
async function renameAgent(agentId: string, name: string): Promise<boolean> {
  const sessions = getSpaBridge()?.sessions;
  if (typeof sessions?.rename !== "function") return false;
  return (await sessions.rename(agentId, name))?.ok === true;
}

/** Store what the operator says this agent is FOR. `''` clears it. */
async function describeAgent(agentId: string, description: string): Promise<boolean> {
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

export interface AgentLaunchPanel {
  open: boolean;
  /** The pre-assigned address, or `null` on a build that cannot pre-assign. */
  agentId: string | null;
  name: string;
  description: string;
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
  toggle: () => void;
  close: () => void;
  reset: () => void;
}

export function useAgentLaunch(): AgentLaunchPanel {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [model, setModel] = useState<string>(AGENT_MODEL_DEFAULT);
  // ⚠ `""` = follow the channel's pick, NOT "the default adapter" — see the
  // field's docblock on `AgentLaunchPanel`.
  const [runtime, setRuntime] = useState<string>("");
  const [identityError, setIdentityError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setOpen(false);
    setAgentId(null);
    setName("");
    setDescription("");
    setTemplateId(null);
    setModel(AGENT_MODEL_DEFAULT);
    setRuntime("");
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
   */
  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setIdentityError(null);
    void mintAgentId().then((minted) => {
      if (!minted) return;
      setAgentId(minted);
      // ⚠ THE NAME AND THE ID COME FROM THE SAME `minted`, IN ONE STATEMENT. Deriving the
      // prefill from a second read of `agentId` would reintroduce the split below by another
      // road: that state is not yet committed here.
      setName((typed) => (typed === "" ? defaultAgentName(minted) : typed));
    });
  }, [open]);

  return {
    open,
    agentId,
    name,
    description,
    templateId,
    model,
    runtime,
    // ⚠ THE NAME IS THE ONLY GATE. A blank agent is a real configuration (no template), so is a
    // model of "Default", and so is an agent with no description — none of those may block a
    // launch. An unnamed one is refused only because the field is prefilled: an empty one means
    // the operator deliberately cleared it, and `Agent #<id>` is what they would get anyway.
    ready: name.trim().length > 0,
    identityError,
    setIdentityError,
    setName,
    setDescription,
    setTemplateId,
    setModel,
    setRuntime,
    toggle,
    close: () => setOpen(false),
    reset,
  };
}

/**
 * THE LAUNCH ITSELF — spawn, then name, then describe. Exported apart from the hook because it
 * is the ACT and the hook is the STATE (§1); `composer.tsx` runs it and owns what to do with the
 * outcome (the template-approval modal is the caller's, exactly as it was for the picker).
 *
 * ⚠ THE ORDER IS NOT NEGOTIABLE. Both writes are keyed by the instance address, so neither can
 * happen until main has answered with one.
 * ⚠ THE ADDRESS IS MAIN'S REPLY, FALLING BACK TO THE PRE-ASSIGNED ONE. On a current build they
 * are the same string; on an older one the reply is the true one and the pre-assigned one was
 * never used. Writing the metadata against the pre-assigned id there would file it under an
 * agent that does not exist.
 */
export async function launchWithIdentity(
  newAgent: AgentLaunchControls,
  panel: AgentLaunchPanel,
  threadId: string | null
): Promise<{
  ok: boolean;
  reason?: string;
  /** ⚠ Rides `template-approval` only, forwarded from main UNTOUCHED — it is what the approval
   *  dialog shows verbatim, and nothing here interprets it. */
  template?: { name?: string | null; instructions?: string | null } | null;
  agentId: string | null;
  identityRefused: boolean;
}> {
  const outcome = await newAgent.launchAgent(
    threadId,
    panel.templateId,
    // ⚠ ABSENT WHEN THE MODEL IS THE DEFAULT, so an untouched panel puts the same payload on the
    // wire a one-click launch always did (`launch-overrides.ts › overridesFor`'s own rule).
    panel.model === AGENT_MODEL_DEFAULT ? undefined : { model: panel.model },
    panel.agentId ?? undefined,
    // ⚠ `undefined` WHEN THE PANEL EXPRESSED NO PREFERENCE, so an untouched panel puts the
    // same payload on the wire a one-click launch always did — `overridesFor`'s own rule,
    // applied to the field main resolves FIRST in its precedence chain.
    panel.runtime || undefined
  );
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      template: outcome.template,
      agentId: null,
      identityRefused: false,
    };
  }
  const address = outcome.agentId ?? panel.agentId;
  if (!address) {
    // The agent started and this build cannot say where. Nothing to key metadata to; the launch
    // is still a success and is reported as one.
    return { ok: true, agentId: null, identityRefused: false };
  }
  const wanted = panel.name.trim();
  // ⚠ THE PREFILL IS NOT A RENAME. Writing `Agent #<id>` into the store would file a "custom"
  // name identical to the fallback, so the operator could never get back to a nameless agent and
  // `agent-names.js`'s bounded set would fill with rows that say nothing.
  const named = wanted === "" || wanted === defaultAgentName(address)
    ? true
    : await renameAgent(address, wanted);
  const described = panel.description.trim() === ""
    ? true
    : await describeAgent(address, panel.description.trim());
  return { ok: true, agentId: address, identityRefused: !named || !described };
}

/**
 * RUNNING A LAUNCH — the three-step act, the foreign-template question, and the relaunch that
 * answers it. Split from `composer.tsx` at the 500-line cap; the seam is §1's own — that file is
 * about SENDING, and this is the launch panel's business end.
 *
 * ⚠ THE RELAUNCH GOES BACK THROUGH {@link launchWithIdentity}, NOT THROUGH A SHORTER RETRY. An
 * approval answers a question and starts nothing, so the second attempt is a whole launch — and
 * a retry path that skipped the rename/describe would silently drop the operator's name and
 * description on exactly the launches that needed two clicks.
 */
export function useLaunchRunner({
  newAgent,
  panel,
  openThreadId,
}: {
  newAgent?: AgentLaunchControls;
  panel: AgentLaunchPanel;
  openThreadId: string | null;
}) {
  const [approval, setApproval] = useState<TemplateApprovalRequest | null>(null);

  const run = useCallback(async () => {
    if (!newAgent || !panel.ready) return;
    const res = await launchWithIdentity(newAgent, panel, openThreadId);
    if (res.reason === LAUNCH_APPROVAL_REASON && panel.templateId) {
      // ⚠ MAIN'S OWN RESOLVED TEXT, read tolerantly — the dialog shows the INSTRUCTIONS the
      // operator is being asked to accept. The local cache's name is only the fallback for a
      // build that sends none; the instructions have no fallback and must not get one, because
      // inventing them is precisely what the question exists to prevent.
      // ⚠ MAIN'S OWN RESOLVED NAME, and no local fallback beyond the generic. The template LIST
      // is no longer in scope here (it is read inside `ComposerLaunch`, which mounts only where a
      // launch is possible), and reaching for it would drag a react-query hook up to the composer
      // — which is exactly the mount the templates read was gated behind.
      setApproval({
        templateId: panel.templateId,
        name: res.template?.name ?? "this template",
        instructions: res.template?.instructions ?? null,
      });
      return;
    }
    if (!res.ok) return; // every other refusal is already said by `newAgent.launchError`
    if (res.identityRefused) {
      // ⚠ THE AGENT IS RUNNING. Closing the panel here would drop the report with it, so the
      // panel stays open holding one line — a launch that succeeded and a write that did not.
      panel.setIdentityError("The agent started, but its name or description was not saved.");
      return;
    }
    panel.reset();
  }, [newAgent, panel, openThreadId]);

  return {
    approval,
    launch: () => void run(),
    cancelApproval: () => setApproval(null),
    confirmApproval: () => {
      const templateId = approval?.templateId;
      setApproval(null);
      if (!templateId || !newAgent) return;
      void newAgent.approveTemplate(templateId).then((res) => {
        if (res.ok) void run();
      });
    },
  };
}

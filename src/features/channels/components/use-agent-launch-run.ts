"use client";

/**
 * RUNNING A LAUNCH — the payload, the three-step act, the foreign-identity question, and the
 * relaunch that answers it.
 *
 * ⚠ **ITS OWN FILE SINCE 2026-09-13, ON THE SEAM `use-agent-launch.ts`'s OWN HEADER ALREADY
 * NAMED**: *"Exported apart from the hook because it is the ACT and the hook is the STATE (§1)"*.
 * The Instructions field's prefill and its baseline pushed that file past the 500-line cap, and
 * this is the split it had been describing for a fortnight — nothing here changed shape in the
 * move except {@link launchOverridesOf}, which is new.
 *
 * ⚠ **NOTHING HERE IS A SECOND LAUNCH LANE.** `use-agents-panel.ts › launchAgent` is still the one
 * act, reached through `AgentLaunchControls`; this file is the popup's business end.
 */

import { useCallback, useState } from "react";
import type { IdentityApprovalRequest } from "@/features/agent-identities/components/identity-approval";
import { NEW_AGENT_NAME } from "@/shared/lib/agent-name";
import {
  MAX_OVERRIDE_INSTRUCTIONS_CHARS,
  type IdentityLaunchOverrides,
} from "@/features/agent-identities/lib/launch-overrides";
import { AGENT_MODEL_DEFAULT } from "../lib/agent-models";
import { LAUNCH_APPROVAL_REASON, type AgentLaunchControls } from "./use-agents-panel";
import {
  describeAgent,
  renameAgent,
  type AgentLaunchPanel,
} from "./use-agent-launch";

/**
 * WHAT THIS SPAWN RE-POINTS — the model, and the instructions if the operator rewrote them.
 *
 * ⚠ **`undefined` WHEN NOTHING CHANGED, AND THAT IS THE WHOLE CONTRACT** (`launch-overrides.ts ›
 * overridesFor`, whose rule this is): an untouched popup must put the payload on the wire that a
 * one-click launch always did, or the two paths an operator reads as "launch this" reach main as
 * two different requests.
 * ⚠ **THE INSTRUCTIONS ARE MEASURED AGAINST THE IDENTITY'S OWN, NOT AGAINST EMPTY.** The field
 * arrives PREFILLED from the identity (`applyIdentity`), so a non-empty test would send the
 * identity's own prose back on every identity launch — a payload that looks like a decision and
 * goes stale the moment the identity is edited between open and Launch.
 * ⚠ **IT IS AN `overrides` MEMBER AND NOT A SEVENTH ARGUMENT**, which is the opposite of where
 * `runtime` and `color` went: those two are properties of the SESSION (the adapter it runs on,
 * its identity in the room) and main reads them off the payload's top level, while instructions
 * are the IDENTITY's prose re-pointed for one spawn — the exact thing `IdentityLaunchOverrides`
 * is. It also means no lane between here and main grew an argument: every caller already forwards
 * `overrides`.
 */
export function launchOverridesOf(
  panel: AgentLaunchPanel
): IdentityLaunchOverrides | undefined {
  const overrides: IdentityLaunchOverrides = {};
  if (panel.model !== AGENT_MODEL_DEFAULT) overrides.model = panel.model;
  const typed = (panel.instructions ?? "").trim();
  if (typed !== (panel.instructionsBaseline ?? "").trim()) {
    // ⚠ BOUNDED AT THE COLUMN'S OWN NUMBER, not a smaller one — the F-287 argument, cited on the
    // constant. Main re-bounds; this is the belt that keeps a pathological paste off the IPC wire.
    overrides.instructions = typed.slice(0, MAX_OVERRIDE_INSTRUCTIONS_CHARS);
  }
  return overrides.model === undefined && overrides.instructions === undefined
    ? undefined
    : overrides;
}

/**
 * THE LAUNCH ITSELF — spawn, then name, then describe. Exported apart from the hook because it
 * is the ACT and the hook is the STATE (§1); `composer.tsx` runs it and owns what to do with the
 * outcome (the identity-approval modal is the caller's, exactly as it was for the picker).
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
  /** ⚠ Rides `identity-approval` only, forwarded from main UNTOUCHED — it is what the approval
   *  dialog shows verbatim, and nothing here interprets it. */
  identity?: { name?: string | null; instructions?: string | null } | null;
  agentId: string | null;
  identityRefused: boolean;
}> {
  const outcome = await newAgent.launchAgent(
    threadId,
    panel.identityId,
    // ⚠ ABSENT WHEN NOTHING WAS RE-POINTED, so an untouched panel puts the same payload on the
    // wire a one-click launch always did (`launch-overrides.ts › overridesFor`'s own rule).
    launchOverridesOf(panel),
    panel.agentId ?? undefined,
    // ⚠ `undefined` WHEN THE PANEL EXPRESSED NO PREFERENCE, so an untouched panel puts the
    // same payload on the wire a one-click launch always did — `overridesFor`'s own rule,
    // applied to the field main resolves FIRST in its precedence chain.
    panel.runtime || undefined,
    /**
     * **THE COLOUR — THE SIXTH ARGUMENT, ON `runtime`'s EXACT ARGUMENT** (2026-09-13;
     * docs/specs/agent-colors.md item 3).
     *
     * ⚠ **`undefined` WHEN THE OPERATOR TOUCHED NO CIRCLE**, so an untouched popup and a
     * one-click launch put the same payload on the wire — `overridesFor`'s rule, applied
     * again. ⚠ AND ABSENT IS NOT "NO COLOUR": the server assigns the FIRST FREE key
     * (`lib/agent-colors.ts › firstFreeAgentColor`), which is what the circles row already
     * PREVIEWS as its default selection. The popup's taken set is advisory — uniqueness is a
     * fact about every member's live agents and only `20261005120000`'s index can decide it.
     * ⚠ **`IdentityLaunchOverrides` IS THE WRONG HOME AND WAS NOT USED** — that object is the
     * IDENTITY's re-points (`launch-overrides.ts`), and a colour is a property of the SESSION
     * IN THE CHANNEL. An identity cannot carry one: the key is unique among a channel's live
     * agents, so a stored default would collide the second time it was used.
     */
    panel.color ?? undefined
  );
  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      identity: outcome.identity,
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
  // **A BLANK NAME IS NAMED `New Agent`, IT IS NOT LEFT NAMELESS** (Samuel, 2026-09-15,
  // verbatim: *"if a user launches an agent with no name, just give it the name, New Agent"*).
  //
  // ⚠ **THIS LINE USED TO DO THE OPPOSITE, AND ITS REASONING WAS SOUND FOR THE PRODUCT IT WAS
  // WRITTEN FOR.** It read *"THE PREFILL IS NOT A RENAME. Writing `Agent #<id>` into the store
  // would file a 'custom' name identical to the fallback, so the operator could never get back
  // to a nameless agent"* — true while the field was PREFILLED with the id and while the unnamed
  // face WAS that id. Both premises are gone: the field opens blank (`use-agent-launch.ts ›
  // openPanel`), so a blank submit is now a deliberate "I have no name for this", and the answer
  // Samuel gave to that is a word rather than an absence.
  //
  // ⚠ **WHY STORE IT RATHER THAN LEAN ON THE DISPLAY FALLBACK**, which would look identical on
  // every card: a STORED name is what puts the agent in the handle namespace. Two blank launches
  // then CONTEST `@new-agent` and the author is told to use the id form
  // (`server/service-wake-verdict-handles.ts › contestedAgentHandles`); two NAMELESS ones would
  // claim nothing, and `@new-agent` would resolve to nobody with nothing to say about why.
  //
  // ⚠ **IT IS STILL RECOVERABLE.** Clearing the field on an existing agent sends `""`, which
  // `agent-names.js › clear` honours — the agent goes back to having no stored name and wears
  // the same face by fallback. This path is about LAUNCH, where Samuel asked for a name.
  // ⚠ **A REFUSAL IS ONLY REPORTED FOR A NAME THE OPERATOR ACTUALLY TYPED.** `renameAgent`
  // answers FALSE on a desktop with no `sessions.rename` op (INVARIANTS §13, a supported peer),
  // and reporting that as `identityRefused` would put an error banner under EVERY blank launch on
  // an older build — for a name nobody asked for. The agent still wears `New Agent` there, by the
  // display fallback, which is the same face; what is lost is only the handle-namespace claim.
  const typed = panel.name.trim();
  const named = await renameAgent(address, typed || NEW_AGENT_NAME);
  const described = panel.description.trim() === ""
    ? true
    : await describeAgent(address, panel.description.trim());
  return { ok: true, agentId: address, identityRefused: (typed !== "" && !named) || !described };
}

/**
 * RUNNING A LAUNCH — the three-step act, the foreign-identity question, and the relaunch that
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
  const [approval, setApproval] = useState<IdentityApprovalRequest | null>(null);

  const run = useCallback(async () => {
    if (!newAgent || !panel.ready) return;
    const res = await launchWithIdentity(newAgent, panel, openThreadId);
    if (res.reason === LAUNCH_APPROVAL_REASON && panel.identityId) {
      // ⚠ MAIN'S OWN RESOLVED TEXT, read tolerantly — the dialog shows the INSTRUCTIONS the
      // operator is being asked to accept. The local cache's name is only the fallback for a
      // build that sends none; the instructions have no fallback and must not get one, because
      // inventing them is precisely what the question exists to prevent.
      // ⚠ MAIN'S OWN RESOLVED NAME, and no local fallback beyond the generic. The identity LIST
      // is no longer in scope here (it is read inside `ComposerLaunch`, which mounts only where a
      // launch is possible), and reaching for it would drag a react-query hook up to the composer
      // — which is exactly the mount the identities read was gated behind.
      setApproval({
        identityId: panel.identityId,
        name: res.identity?.name ?? "this identity",
        instructions: res.identity?.instructions ?? null,
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
      const identityId = approval?.identityId;
      setApproval(null);
      if (!identityId || !newAgent) return;
      void newAgent.approveIdentity(identityId).then((res) => {
        if (res.ok) void run();
      });
    },
  };
}

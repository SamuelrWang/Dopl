"use client";

/**
 * THE AUTO-SEND + FULL-TOOLS + PEER WARNING (Samuel's ruling, 2026-08-26 —
 * `docs/specs/home-knowledge-panels.plan.md` §6, M6).
 *
 * THE COMBINATION IT IS ABOUT. Three settings that are each defensible alone add
 * up to one that is not: the Sends axis at `auto_both` (the agent sends without
 * being asked), the channel's tool profile at `full` (no `--tools` bound, no
 * `--allowedTools`, and the operator's OWN connected MCP servers loaded — see
 * `settings-agent.tsx › TOOL_PROFILE_OPTIONS`), and somebody ELSE on the roster.
 * Together they mean whatever the agent's unrestricted tools produce reaches that
 * person with no human between. Egress is otherwise already solved by outbound
 * consent; `auto_both` is precisely the setting that spends it.
 *
 * ⚠ IT IS A DIALOG AT THE MOMENT OF SETTING, NEVER A STANDING BANNER, and that
 * is the MINIMAL-COPY RULING (Samuel, 2026-08-19 — `settings-agent.tsx`'s
 * docblock, INVARIANTS §5): a row on the Settings tab is a NAME and a CONTROL,
 * with no paragraph-style block anywhere. An explainer that is always on screen
 * is read once and then never again; a confirmation is read every time it fires,
 * which is exactly the number of times this combination gets created.
 *
 * ⚠ IT FIRES ON THE TRANSITION INTO THE COMBINATION, NOT ON BEING IN IT. A
 * channel already sitting at `auto_both` + `full` asks nothing when the operator
 * moves the model, or the Permissions axis, or anything else — re-asking about a
 * state the operator already confirmed is how a confirmation becomes a thing
 * people click through without reading. {@link entersPostureWarning} is the
 * whole of that rule, and both axes are routed through it because EITHER one can
 * be the flip.
 *
 * ⚠ IT IS A HUMAN'S CONFIRMATION, NOT AN ENFORCEMENT — the same standing that
 * `go-public-dialog.tsx` states for its own. Nothing here bounds what the agent
 * may reach: containment is the tool profile and `main/session-profiles.js`, and
 * the audience ceiling is a container-side grant fence (plan §4). Cancelling
 * leaves the setting untouched; confirming writes exactly the write the click
 * asked for and nothing else.
 *
 * ⚠ ONE FILE — PREDICATE, COPY AND DIALOG — on `go-public-dialog.tsx`'s
 * precedent: "does this need a human?" and "what does the human read?" live next
 * to each other rather than being re-derived at the call site. The plan named a
 * `.ts`; it carries JSX, so it is a `.tsx`. It also exists because
 * `settings-agent.tsx` runs within a few lines of the 500-line cap (INVARIANTS
 * §1) — but the seam would be right at any size, and `agents-controls.ts` was
 * refused as a home: that file's one reason to change is THE BRIDGE GROWING AN
 * OP, and this reaches no bridge.
 */

import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { MessageMode, PermissionPreset } from "../../lib/permission-modes";
import type { AgentToolProfile } from "../../types";

/**
 * The only thing the warning needs off a roster row — `ChannelMember` satisfies
 * it structurally. ⚠ Deliberately narrow: this module decides whether somebody
 * ELSE is present and what to call them, and nothing about their role, their
 * agent or their access. A wider type here would invite a fourth conjunct.
 */
export interface PostureRosterMember {
  userId: string;
  displayName?: string | null;
  email?: string | null;
}

export interface PostureWarningInputs {
  /**
   * The DURABLE launch posture's Sends axis, or `null` when there is no posture
   * to read — a plain browser, or a desktop older than the bridge.
   *
   * ⚠ NULL IS "CANNOT SAY", AND IT WARNS ABOUT NOTHING (INVARIANTS §11 — UNKNOWN
   * is not EMPTY). Without the bridge the Settings tab renders no posture control
   * at all, so there is no axis to flip and no launch this machine will run;
   * inventing `ask` here would be this module answering a question it was not
   * told the answer to.
   */
  messageMode: MessageMode | null;
  /** The channel's DURABLE tool profile for THIS caller (never a teammate's). */
  toolProfile: AgentToolProfile;
  /** The channel roster as the surface already has it — no read of its own. */
  roster: readonly PostureRosterMember[];
  /** The caller, so their own row is not mistaken for a peer. */
  currentUserId: string | null;
}

/**
 * IS THIS CHANNEL IN THE COMBINATION? The three conjuncts, and nothing else.
 *
 * ⚠ A CONJUNCTION, SO ANY ONE OF THE THREE BEING FALSE IS THE WHOLE ANSWER —
 * `full` tools on a solo channel reaches nobody, `auto_both` on a restricted
 * profile sends what a restricted agent produced, and either of them with no peer
 * on the roster is the operator talking to themselves.
 *
 * ⚠ `currentUserId` NULL MEANS NO ROW CAN BE RULED OUT AS THE CALLER'S OWN, so a
 * one-person roster would read as a peer. It is treated as UNKNOWN and warns
 * about nothing, for the same reason `messageMode` null does: the one production
 * mount always passes it (`channel-manage.tsx`), and a warning naming a peer who
 * is actually you is the failure that teaches people to dismiss this dialog.
 */
export function warrantsPostureWarning(input: PostureWarningInputs): boolean {
  if (input.messageMode !== "auto_both") return false;
  if (input.toolProfile !== "full") return false;
  if (!input.currentUserId) return false;
  return input.roster.some((m) => m.userId !== input.currentUserId);
}

/**
 * DOES MOVING FROM `before` TO `after` ENTER the combination — the actual trigger.
 *
 * ⚠ NOT `warrantsPostureWarning(after)`. A channel already in the combination
 * must not re-ask on every unrelated setting, and a change that LEAVES it must
 * not ask at all. Widening takes a human; staying put and narrowing do not — the
 * same asymmetry `go-public-dialog.tsx › needsGoPublicConfirm` draws.
 */
export function entersPostureWarning(
  before: PostureWarningInputs,
  after: PostureWarningInputs
): boolean {
  return !warrantsPostureWarning(before) && warrantsPostureWarning(after);
}

/**
 * WHAT TO CALL THE AUDIENCE. ⚠ Only ever rendered when the predicate is true, so
 * there is at least one peer; the empty answer exists for the type, not for a
 * surface. One peer is NAMED (the plan's "naming the peer") — a warning about
 * "another member" is a warning about nobody in particular. Several are counted
 * rather than listed: a roster of nine does not fit in a confirm dialog's
 * sentence, and a truncated list reads as the whole audience.
 */
export function posturePeerLabel(
  roster: readonly PostureRosterMember[],
  currentUserId: string | null
): string {
  const peers = roster.filter((m) => m.userId !== currentUserId);
  if (peers.length === 0) return "your teammates";
  if (peers.length > 1) return `the ${peers.length} other people here`;
  const only = peers[0];
  return only.displayName?.trim() || only.email?.trim() || "your teammate";
}

/**
 * THE COPY, EXPORTED RATHER THAN INLINED IN THE JSX — `ModalShell` portals itself
 * in from an effect, so a static render of an open dialog is the empty string and
 * a test has no other way to hold this wording to account. Same split
 * `go-public-dialog.tsx` states.
 *
 * ⚠ IT NAMES THE RISK, NOT THE SETTINGS. The operator just moved one of the two
 * controls and can see both; what they cannot see is the consequence of the pair
 * — that the review step is the thing being switched off. "Without your review"
 * is the load-bearing half of the sentence and must survive any rewrite.
 * ⚠ IT PROMISES NOTHING ABOUT WHAT IS WITHHELD, the rule
 * `settings-agent.tsx › TOOL_PROFILE_OPTIONS` states for the `full` line: the
 * hard-deny sets differ between the two lanes, so a sentence about them is true
 * on one and wrong on the other.
 */
export const POSTURE_WARNING_TITLE = "Send without your review?";

export function postureWarningDescription(peerLabel: string): string {
  return (
    `Your agent here will have full tools and will send on its own, so ` +
    `whatever it produces — from any file, app or connected service it can ` +
    `reach — goes to ${peerLabel} without your review.`
  );
}

/** The confirm button. ⚠ It names the ACT, not "OK": the destructive face plus a
 *  neutral verb is a dialog people confirm by reflex. */
export const POSTURE_WARNING_CONFIRM = "Turn it on";

/**
 * The change being held, so the confirm can commit EXACTLY the write the click
 * asked for. ⚠ The two axes live on two different writes — the posture is a
 * desktop-bridge record and the tool profile is a server mutation — so this
 * cannot collapse to one "apply" callback.
 */
type PendingPostureChange =
  | { kind: "posture"; patch: Partial<PermissionPreset> }
  | { kind: "profile"; profile: AgentToolProfile };

export interface PostureWarningGate {
  /** Call INSTEAD OF the posture write; commits, or opens the dialog first. */
  changePosture: (patch: Partial<PermissionPreset>) => void;
  /** Call INSTEAD OF the tool-profile write; same contract. */
  setToolProfile: (profile: AgentToolProfile) => void;
  /** Mount once, anywhere in the subtree — it portals itself. */
  dialog: ReactNode;
}

/**
 * WRAP BOTH WRITES IN THE WARNING. Everything the host has to do is call the two
 * returned callbacks where it called its own, and render {@link
 * PostureWarningGate.dialog}.
 *
 * ⚠ THE DIALOG FIRES BEFORE THE WRITE, NOT AFTER IT. Cancel therefore leaves the
 * setting exactly as it was — there is no revert path, because nothing was
 * written. A confirm-then-undo shape would have to reverse a desktop record and a
 * server mutation, and would leave the combination live in between.
 */
export function usePostureWarning(
  input: PostureWarningInputs & {
    commitPosture: (patch: Partial<PermissionPreset>) => void;
    commitToolProfile: (profile: AgentToolProfile) => void;
  }
): PostureWarningGate {
  const [pending, setPending] = useState<PendingPostureChange | null>(null);

  const before: PostureWarningInputs = {
    messageMode: input.messageMode,
    toolProfile: input.toolProfile,
    roster: input.roster,
    currentUserId: input.currentUserId,
  };

  function changePosture(patch: Partial<PermissionPreset>) {
    // ⚠ `?? before.messageMode`: a patch that moves the OTHER axis (or the
    // model) carries no `messages` key, and must compare as no change at all.
    const after = { ...before, messageMode: patch.messages ?? before.messageMode };
    if (entersPostureWarning(before, after)) {
      setPending({ kind: "posture", patch });
      return;
    }
    input.commitPosture(patch);
  }

  function setToolProfile(profile: AgentToolProfile) {
    if (entersPostureWarning(before, { ...before, toolProfile: profile })) {
      setPending({ kind: "profile", profile });
      return;
    }
    input.commitToolProfile(profile);
  }

  function confirm() {
    if (!pending) return;
    if (pending.kind === "posture") input.commitPosture(pending.patch);
    else input.commitToolProfile(pending.profile);
  }

  return {
    changePosture,
    setToolProfile,
    dialog: (
      <ConfirmDialog
        open={pending !== null}
        // ⚠ Cancel AND the post-confirm close both land here; clearing the held
        // change is right for both, and `onConfirm` has already read it.
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={POSTURE_WARNING_TITLE}
        description={postureWarningDescription(
          posturePeerLabel(input.roster, input.currentUserId)
        )}
        confirmLabel={POSTURE_WARNING_CONFIRM}
        destructive
        onConfirm={confirm}
      />
    ),
  };
}

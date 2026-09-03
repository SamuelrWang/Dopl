import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import {
  agentTemplateErrorMessage,
  agentTemplateRequest,
} from "@/features/agent-templates/client/api";
import type { AgentTemplate } from "@/features/agent-templates/client/types";

/**
 * "SHARE INTO THIS CHANNEL" — the one control that gets a personal agent in
 * front of the other people in a home channel (Samuel's ruling B11, 2026-09-02,
 * wave B slice B15: *grants replace copies*).
 *
 * ⚠ **IT WAS "USE IN THIS CHANNEL" AND IT WAS A COPY** (`agent-copy.tsx`,
 * Samuel's ruling Q2, 2026-08-26, deleted with this file's arrival). That
 * control composed a whole second ROW client-side — `containerCopyDraft` +
 * the container's create hook — and everything about it followed from the copy
 * being a copy: the attached knowledge bases were DROPPED (their ids meant
 * nothing in the container), the two rows were STRANGERS from the moment the
 * POST returned, and a rename or an edit reached only one of them. The confirm
 * step existed largely to say those three things.
 *
 * 🔒 **A GRANT LENDS THE ONE ROW, SO ALL THREE STOP BEING TRUE.** The template
 * stays in the operator's personal container, where they edit it and where its
 * attachments still resolve; the channel gets a `resource_grants` row pointing
 * at it. An edit reaches everyone it is lent to, which is the whole of B11.
 *
 * ⚠ **THE AUDIENCE SENTENCE SURVIVES THE MECHANISM, AND IT IS STILL THE CONSENT
 * STEP.** "Everyone here will see it" was true of the copy and is true of the
 * grant; INVARIANTS §5A says that if that sentence is softened the semantics are
 * wrong again, and that has not changed. What LEAVES the copy is the snapshot
 * line and the dropped-attachments line, because neither is a fact any more.
 *
 * ⚠ **AND ONE THING IS HONESTLY LESS TRUE THAN IT WAS, SO THE COPY SAYS SO.**
 * The READ half of a container grant is not built (F-604): `canSeeTemplate` has
 * no arm for it yet, so the row is recorded and does not appear in the channel's
 * list until B16 adds the arm and its RLS twin. The dialog does not claim the
 * peer can see it today.
 */

/** The card control. ⚠ A `<button>` inside the card's face, never over it —
 *  see `template-section.tsx › TemplateCard`. */
export function ShareIntoChannelButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <OpenScaleButton
      onClick={onClick}
      disabled={disabled}
      className="disabled:opacity-60"
    >
      Share into this channel
    </OpenScaleButton>
  );
}

/**
 * The confirm step and the write.
 *
 * ⚠ MOUNTED ONLY WHILE A SHARE IS PENDING — the same reason the copy dialog
 * was, minus the writes hook: a grant touches no template cache entry, because
 * it changes no template row. **There is nothing to patch optimistically**, and
 * that is the F-331 hazard this control no longer has.
 *
 * ⚠ A FAILED WRITE KEEPS THE DIALOG OPEN AND PUTS THE SERVER'S OWN WORDING IN
 * IT. `ConfirmDialog` closes on a resolved `onConfirm` and stays open on a
 * throw, so the rethrow below is load-bearing.
 */
export function ShareIntoChannelDialog({
  source,
  channelId,
  onClose,
  onShared,
}: {
  /** The PERSONAL-container row being lent. */
  source: AgentTemplate;
  /** The CHANNEL the grant is scoped to — not the container. A `channel` scope
   *  is what puts the row in front of the people in the room. */
  channelId: string;
  onClose: () => void;
  onShared: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setError(null);
    try {
      await agentTemplateRequest("/api/resource-grants", {
        method: "PUT",
        body: {
          resourceType: "agent_template",
          resourceId: source.id,
          scopeType: "channel",
          scopeId: channelId,
          // ⚠ `visible`, THE NARROWER OF THE TWO CHANNEL WORDS. `agent_only`
          // names no human audience at all, which is not what a control called
          // "share into this channel" promises.
          level: "visible",
        },
      });
      onShared();
    } catch (err) {
      setError(
        agentTemplateErrorMessage(err, "Couldn't share the agent into this channel")
      );
      // ⚠ RETHROWN so the dialog stays open with the line above in it.
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Share "${source.name}" into this channel?`}
      description={describe(error)}
      confirmLabel="Share"
      onConfirm={share}
    />
  );
}

/**
 * What the operator is told before they press.
 *
 * ⚠ TWO SENTENCES, EACH A RULING RATHER THAN AN EXPLAINER (minimal UI copy,
 * INVARIANTS §5). The first is the AUDIENCE and is the consent step; the second
 * is the one fact that separates this from the copy it replaced, and it is the
 * one an operator will otherwise get wrong — they still own the agent, and their
 * next edit travels.
 */
function describe(error: string | null): string {
  const lines = [
    "This shares your agent into this channel — everyone here will see it.",
    "It stays yours: you keep editing it where it is, and your changes reach everyone it's shared with.",
  ];
  if (error) lines.push(error);
  return lines.join("\n");
}

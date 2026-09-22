import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { toast } from "@/shared/ui/toast";
import {
  canLaunchAgents,
  launchAgentOnThread,
} from "@/features/channels/components/agents-controls";
import {
  LAUNCH_APPROVAL_REASON,
  launchRefusalText,
} from "@/features/channels/components/use-agents-panel";
import {
  describeAgent,
  renameAgent,
} from "@/features/channels/components/use-agent-launch";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
import type { Channel } from "@/features/channels/types";
import { channelTitle } from "./home-rows";

/**
 * **LAUNCH, FROM THE CARD, AS-IS** (Samuel, 2026-09-22: the agent card's control
 * *"should say Launch"*, sit *"on the bottom right of the card"*, and a click
 * *"launches that template as is, directly into the selected channel"*).
 *
 * ⚠ **IT REPLACED "Share into this channel" AND THAT FILE IS DELETED**
 * (`agent-share.tsx`, the grant dialog of slice B15). The card now carries ONE
 * second control and it is this one; a grant is still writable through
 * `dopl_agent(op="grant")`, which is where that capability lives now.
 *
 * ⚠ **AS-IS MEANS NO FORM.** The New-agent popup exists to CHANGE what a launch
 * carries (`channels/components/launch-agent-dialog.tsx`); this control exists
 * because Samuel asked for the launch that changes nothing — so it sends the
 * template id and NOTHING else, which is byte-for-byte the payload the composer's
 * one-click launch puts on the wire (`use-agents-panel.ts › launchAgent`'s own
 * rule: absent, never `undefined`-valued).
 *
 * ⚠ **THE AGENT IS NAMED AFTER THE TEMPLATE, AND THAT IS THE POPUP'S OWN
 * BEHAVIOUR** rather than an invention here: `use-agent-launch.ts › applyTemplate`
 * prefills the Name field from the template, and `launchWithIdentity` writes it
 * after the spawn. Both writes are keyed by the instance address, so neither can
 * happen until main has answered with one.
 * ⚠ **A REFUSED RENAME IS NOT A REFUSED LAUNCH.** The agent is already running by
 * then and an older desktop ships no `sessions.rename` at all; reporting that as
 * a failed launch would be a lie about the thing that mattered.
 *
 * ⚠ **THE WORKSPACE ON THE PAYLOAD IS THE TEMPLATE'S OWN, NOT THE CHANNEL'S.**
 * Main resolves the row at spawn with it (`main/template-resolve.js ›
 * resolveTemplate`, which reads `(workspace_id, id)`), and these cards are the
 * caller's PERSONAL shelf — rows that live in their home workspace. Sending the
 * channel's container id here would 404 every one of them.
 */

/** The card control — the same small pill the card's other buttons wear.
 *  ⚠ A `<button>` INSIDE the card's face, never over it: see
 *  `template-section.tsx › TemplateCard`. */
export function LaunchIntoChannelButton({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void;
  /** ⚠ **THE LAUNCH IS IN FLIGHT ON THIS ROW** (Samuel: *"when the user clicks
   *  launch, maybe a small spinner or loading state on the button so that the
   *  user sees something happened"*). It is per-ROW, not per-pane: a spinner on
   *  every card would say the wrong thing about the fifteen that are idle. */
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <OpenScaleButton
      onClick={onClick}
      disabled={disabled || busy}
      className="gap-1.5 disabled:opacity-60"
    >
      {busy && (
        <Loader2
          size={OPEN_SCALE_ICON}
          aria-hidden="true"
          className="animate-spin"
        />
      )}
      Launch
    </OpenScaleButton>
  );
}

/** Which row is launching, and the one line a refusal gets. */
export interface CardLaunch {
  /** The bridge op exists on this build. ⚠ Absent ⇒ offer no control at all —
   *  a launch button in a plain browser can only refuse. */
  canLaunch: boolean;
  /** The template id with a launch in flight, or `null`. */
  busyId: string | null;
  /** The last refusal, ON THE ROW THAT EARNED IT. ⚠ Never swallowed: a refusal
   *  is not a push, so the card is the only place it can be said. */
  error: { templateId: string; message: string } | null;
  launch: (template: AgentTemplate) => void;
}

export function useCardLaunch(channel: Channel | null): CardLaunch {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<CardLaunch["error"]>(null);

  const run = useCallback(
    async (template: AgentTemplate) => {
      // ⚠ ONE LAUNCH IN FLIGHT ACROSS THE PANE — a double-submit guard over a
      // single click, exactly `use-agents-panel.ts › launchBusy`'s scope, and
      // not a cap on how many agents a channel may hold.
      if (!channel || busyId !== null) return;
      setBusyId(template.id);
      setError(null);
      try {
        const res = await launchAgentOnThread({
          channelId: channel.id,
          // ⚠ `null` IS A CHANNEL-LEVEL AGENT and is not a missing value: this
          // card names no exchange, so there is nobody on the other side of it.
          taskId: null,
          workspaceId: template.workspaceId,
          channelName: channel.name,
          threadTitle: null,
          // ⚠ NO COUNTERPARTY, AND THAT IS NOT A REFUSAL — see `launchAgent`'s
          // own note: the refusal is about a THREAD whose other party could not
          // be resolved, which is a different fact.
          counterpartyId: null,
          direct: channel.isDirect,
          templateId: template.id,
        });
        if (!res.ok) {
          setError({
            templateId: template.id,
            message:
              res.reason === LAUNCH_APPROVAL_REASON
                ? // ⚠ NOT REACHABLE FROM THESE ROWS TODAY (they are the caller's
                  // own templates, and main asks only for a FOREIGN one's first
                  // run) — and said honestly rather than reported as a failure,
                  // because the approval question belongs to the popup that can
                  // show the instructions being accepted.
                  "Launch it from the channel once to approve it"
                : launchRefusalText(res.reason),
          });
          return;
        }
        const address = res.agentId;
        if (address) {
          await renameAgent(address, template.name);
          const described = template.description?.trim();
          if (described) await describeAgent(address, described);
        }
        // 🔒 **THE POPUP SAMUEL ASKED FOR, VERBATIM**: *"'name of agent'
        // launched into 'name of channel'"*. The NAME is the template's, which
        // is the name the agent now wears; the CHANNEL is `channelTitle`'s — a
        // channel's own display identity, never its roster (`home-rows.ts`).
        toast({
          title: `"${template.name}" launched into "${channelTitle(channel)}"`,
          variant: "invert",
        });
      } finally {
        setBusyId(null);
      }
    },
    [channel, busyId]
  );

  return {
    // ⚠ FEATURE-DETECTED ON THE OP ABOUT TO BE USED, at the call site, never on
    // `window.dopl` being truthy (`agents-controls.ts`'s rule for the family).
    canLaunch: canLaunchAgents(),
    busyId,
    error,
    launch: (template) => void run(template),
  };
}

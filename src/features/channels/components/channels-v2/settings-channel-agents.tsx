"use client";

/**
 * **THE CHANNEL'S OWN AGENT SETTINGS — the DEFAULT RESPONDER and the POSTURE
 * CEILING, in ONE manage-gated panel** (2026-09-02, v2 wave B slice B4 —
 * Samuel's rulings B1/B6, and F-449).
 *
 * ⚠ **TWO SETTINGS, ONE PANEL, ONE GATE — DELIBERATELY, NOT FOR TIDINESS.** The
 * ceiling (`channels.agent_*`) has had a server clamp since A9 and NO EDITING
 * SURFACE AT ALL, which is F-449: a clamp that is armed and unarmed at once,
 * because every channel's ceiling is NULL and nothing can set one. The default
 * responder arrives with the same shape — a channel property, manage-gated,
 * about somebody else's machine. A second surface for the second setting would
 * be the thing to avoid.
 *
 * ⚠ **THE SERVER IS THE GATE, THIS IS AN AFFORDANCE.**
 * `service-writes.ts › MANAGED_CHANNEL_FIELDS` floors both fields at the
 * channel's manage role; hiding the rows here changes nothing about who may
 * write them. The rows are absent rather than disabled for a non-manager, which
 * is the NO DEAD ROWS rule this tab already keeps.
 *
 * ⚠ **NO EXPLAINER COPY** (Samuel's minimal-UI ruling, INVARIANTS §5): a row is
 * a label and a control. The per-option second lines come from the shared
 * `TOOL_OPTIONS` / `MESSAGE_OPTIONS`, which is where that vocabulary already
 * lives, and this file adds no sentence of its own.
 *
 * ⚠ **THE RESPONDER PICKER OFFERS THE ROOM'S LIVE AGENTS, PLUS THE STORED VALUE
 * WHEN IT IS NOT AMONG THEM.** `SelectMenu` renders BLANK for a value matching
 * no option, so a nomination whose agent is not running right now would look
 * like "nobody is nominated" — and clearing a setting by accident is the failure
 * this control most has to avoid. The stored handle is therefore always an
 * option, marked as not running.
 */

import { SelectMenu } from "@/shared/ui/select-menu";
import { agentIdHandle, agentMentionHandle } from "../../lib/agent-mentions";
import { MESSAGE_OPTIONS, TOOL_OPTIONS } from "../permission-preset-row";
import type { MessageMode, ToolMode } from "../../lib/permission-modes";
import { GroupLabel, SettingRow } from "./settings-agent-rows";
import type { Channel } from "../../types";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";

/** ⚠ THE SENTINEL FOR "NO OPINION". `SelectMenu` is a closed set of STRINGS, so
 *  `null` — which is what the wire carries and what clears the setting — has to
 *  be spelled as one of them. It is a value no handle can be: the grammar
 *  (`^[a-z][a-z0-9-]{1,30}$`) forbids the leading `-`. */
const NONE = "-none-";

const CHAIN_OPTIONS = [
  { value: NONE, label: "No ceiling" },
  { value: "yes", label: "Allowed" },
  { value: "no", label: "Not allowed" },
] as const;

export interface ChannelAgentsSettingsProps {
  channel: Channel;
  /** Every member's live sessions in this room — the Agents tab's own read. */
  sessions: readonly ChannelPeerSession[];
  busy?: boolean;
  /** `null` withdraws the nomination. */
  onSetDefaultResponder: (handle: string | null) => void;
  /** ⚠ PER AXIS, and `null` is a VALUE: it removes the ceiling on that axis.
   *  Collapsing it with "unchanged" would make a ceiling permanent — the same
   *  distinction `service-writes.ts › updateChannel` keeps. */
  onSetCeiling: (patch: {
    tools?: ToolMode | null;
    messages?: MessageMode | null;
    chain?: boolean | null;
  }) => void;
}

export function ChannelAgentsSettings({
  channel,
  sessions,
  busy,
  onSetDefaultResponder,
  onSetCeiling,
}: ChannelAgentsSettingsProps) {
  const stored = channel.defaultResponderAgentName;
  const live = sessions
    .filter((s) => s.name.length > 0)
    .map((s) => ({
      value: agentMentionHandle({ agentId: s.name, displayName: s.displayName }),
      label: s.displayName ?? agentIdHandle(s.name),
    }));
  const seen = new Set(live.map((o) => o.value));
  const responderOptions = [
    { value: NONE, label: "No one" },
    ...live,
    // ⚠ THE STORED VALUE, ALWAYS — see the header. A blank trigger reads as
    // "nobody is nominated" and one click away is clearing it for real.
    ...(stored !== null && !seen.has(stored)
      ? [{ value: stored, label: stored, description: "Not running" }]
      : []),
  ];

  const posture = channel.agentPosture;

  return (
    <>
      <GroupLabel>Channel agents</GroupLabel>
      <div className="flex flex-col gap-1 px-2">
        <SettingRow name="Answers unaddressed messages">
          <SelectMenu<string>
            value={stored ?? NONE}
            options={responderOptions}
            onChange={(next) =>
              onSetDefaultResponder(next === NONE ? null : next)
            }
            ariaLabel="Agent that answers unaddressed messages in this channel"
            disabled={busy}
          />
        </SettingRow>
        <SettingRow name="Tools ceiling">
          <SelectMenu<string>
            value={posture.tools ?? NONE}
            options={[{ value: NONE, label: "No ceiling" }, ...TOOL_OPTIONS]}
            onChange={(next) =>
              onSetCeiling({ tools: next === NONE ? null : (next as ToolMode) })
            }
            ariaLabel="Widest tool mode an agent launched in this channel may run"
            disabled={busy}
          />
        </SettingRow>
        <SettingRow name="Messages ceiling">
          <SelectMenu<string>
            value={posture.messages ?? NONE}
            options={[{ value: NONE, label: "No ceiling" }, ...MESSAGE_OPTIONS]}
            onChange={(next) =>
              onSetCeiling({
                messages: next === NONE ? null : (next as MessageMode),
              })
            }
            ariaLabel="Widest message mode an agent launched in this channel may run"
            disabled={busy}
          />
        </SettingRow>
        <SettingRow name="Launching more agents">
          <SelectMenu<string>
            value={posture.chain === null ? NONE : posture.chain ? "yes" : "no"}
            options={CHAIN_OPTIONS}
            onChange={(next) =>
              onSetCeiling({ chain: next === NONE ? null : next === "yes" })
            }
            ariaLabel="May an agent launched in this channel launch further agents"
            disabled={busy}
          />
        </SettingRow>
      </div>
    </>
  );
}

"use client";

/**
 * **WHO ANSWERS *MY* UNADDRESSED MESSAGES IN THIS CHANNEL** — one per-member control
 * (2026-09-07, Samuel's ruling on items 10 and 11; was the channel's agent panel, B4).
 *
 * ⚠ **IT IS A DIFFERENT SETTING FROM THE ONE THIS FILE USED TO HOLD, NOT A RESTYLED ONE.** The
 * panel carried a room MANAGER's pin of ONE specific agent to answer EVERY member's untagged
 * messages, plus the three posture-ceiling rows. His reasoning for killing the pin, verbatim:
 * *"if there's another member in the room, their last agent address would be different from my
 * last agent address."* One room cannot hold one answer to a per-person question.
 *
 * ⚠ **SO THE GATE CHANGED WITH IT, AND THAT IS THE LOAD-BEARING PART OF THIS FILE.** The old
 * panel was MANAGE-gated because it decided something about somebody else's machine. This one
 * writes the CALLER'S OWN `channel_members` row and reaches nobody else, so it is gated on
 * MEMBERSHIP. Leaving it behind `canManage` would have hidden a personal setting from every
 * non-manager in the room while the server went on honouring it — a control that shows half of
 * what it governs, which is the defect class this wave exists to remove.
 *
 * ⚠ **TWO OPTIONS, AND DELIBERATELY NO "PIN A SPECIFIC AGENT".** Agents are EPHEMERAL — they
 * end, and their ids are minted per launch — so a stored handle decays into naming nothing.
 * That decay is the defect the old column had, not an implementation detail of it. It is why
 * this control needs no live-sessions read at all: the old picker had to offer the room's
 * running agents (plus the stored value, marked "Not running", so a blank trigger could not be
 * mistaken for "nobody nominated"), and there is no agent to name here.
 *
 * ⚠ **"Last Agent Addressed" IS THE DEFAULT AND THAT IS A STANDING RULING, NOT A PREFERENCE.**
 * B1 (2026-09-04): a forgotten `@` must never stall a conversation, made off a live incident —
 * a person wrote in a room with two live agents and no default, the post fed 0 of 2, and he had
 * to send it again with a tag. So a member who never opens this panel is answered.
 *
 * ⚠ **"No one" KILLS EVERY FALLBACK, NOT JUST RECENCY** (`lib/agent-mentions.ts ›
 * resolveDefaultResponder` short-circuits on its first line): a room with exactly one live
 * agent does not auto-answer either. That is the whole content of the option, and it is why
 * the composer's recipient line reads `nobody` under it.
 *
 * ⚠ **NO EXPLAINER COPY** (Samuel's minimal-UI ruling, INVARIANTS §5): a row is a label and a
 * control. The two option labels carry their own meaning and this file adds no sentence.
 */

import { SelectMenu } from "@/shared/ui/select-menu";
import { viewerUnaddressedResponder } from "../../lib/draft-recipients";
import {
  UNADDRESSED_RESPONDER_DEFAULT,
  type UnaddressedResponderSetting,
} from "../../lib/agent-mentions";
import { GroupLabel, SettingRow } from "./settings-agent-rows";
import type { ChannelMember } from "../../types";

/**
 * ⚠ **THE CLOSED SET, RENDERED — AND `UNADDRESSED_RESPONDER_DEFAULT` IS NOT RE-SPELLED HERE.**
 * The default is imported rather than written as `"last_addressed"` a second time, because
 * which value is the default is a ruling and the shared module owns it.
 *
 * ⚠ **THERE IS NO "NO OPINION" SENTINEL, UNLIKE THE PICKER THIS REPLACED.** That control needed
 * a `-none-` string because `null` — "nobody nominated" — was a third state `SelectMenu` could
 * not spell. The column is `NOT NULL` with two values now, so the unconfigured member simply
 * reads as the default, and there is no clear to express.
 */
const RESPONDER_OPTIONS: {
  value: UnaddressedResponderSetting;
  label: string;
}[] = [
  { value: "none", label: "No one" },
  { value: UNADDRESSED_RESPONDER_DEFAULT, label: "Last Agent Addressed" },
];

export interface ChannelAgentsSettingsProps {
  /**
   * ⚠ **THE ROSTER, NOT THE CHANNEL** (2026-09-07). The setting is a fact about the viewer's own
   * membership row, and this surface already holds the roster for the members list. Passing
   * `channel` would suggest a room-wide value, which is exactly the reading that was ruled out.
   */
  members: readonly ChannelMember[];
  currentUserId: string;
  busy?: boolean;
  onSetUnaddressedResponder: (setting: UnaddressedResponderSetting) => void;
  // ⚠ `sessions` REMOVED 2026-09-07: the old picker offered the room's live agents as options
  // and this control names no agent, so the panel no longer justifies a peer poll of its own.
  // ⚠ `onSetCeiling` REMOVED 2026-09-06 (items 12, 13, 14) with the channel posture ceiling.
}

export function ChannelAgentsSettings({
  members,
  currentUserId,
  busy,
  onSetUnaddressedResponder,
}: ChannelAgentsSettingsProps) {
  // ⚠ **THE SAME FUNCTION THE RECIPIENT LINE USES, DELIBERATELY** (`lib/draft-recipients.ts ›
  // viewerUnaddressedResponder`). If this control and the composer's line disagreed about which
  // row is "mine" or what an unloaded roster means, the panel would report a setting the line
  // does not predict — and a person would have no way to tell which one the server believed.
  // ⚠ It fails to the DEFAULT, never to `"none"`: a roster still loading must not render as
  // "you chose nobody", which is a claim, not an absence.
  const value = viewerUnaddressedResponder(members, currentUserId);

  return (
    <>
      <GroupLabel>Agents</GroupLabel>
      <div className="flex flex-col gap-1 px-2">
        {/* ⚠ THE LABEL SAYS "MY", because the row above it does not: this is the one control on
            this tab whose scope a reader could otherwise mistake for the room's. */}
        <SettingRow name="Answers my unaddressed messages">
          <SelectMenu<UnaddressedResponderSetting>
            variant="text"
            value={value}
            options={RESPONDER_OPTIONS}
            onChange={onSetUnaddressedResponder}
            ariaLabel="Who answers my unaddressed messages in this channel"
            disabled={busy}
          />
        </SettingRow>
      </div>
    </>
  );
}

// ⚠ **THE POSTURE CEILING'S THREE ROWS WERE DELETED FROM THIS FILE ON 2026-09-06** (Samuel's
// rulings on items 12, 13 and 14; *"Make sure all the logic is deleted."* Tools: *"all agents
// launched should just inherit the original tools' permissions."*). The argument is kept here
// rather than left to be inferred from an absence, because all three were CONTAINMENT controls
// and he was told so before ruling: they were a room MANAGER's clamps over EVERY member's
// agents in this channel — the widest tool mode a launch here could run, how freely those
// agents could auto-send, and whether they could launch further agents (`agent_chain_allowed`
// REFUSED at creation rather than clamping, because a clamped chain hits a bound mid-run).
//
// ⚠ NONE OF THEM DUPLICATED THE OPERATOR'S OWN TAB, which governs the operator's OWN agents on
// their OWN machine; these governed everybody's. **So this room no longer bounds a peer's agent
// on any axis** — a member's agents here run at whatever that member set on their own machine.
//
// ⚠ AND WITH THE RESPONDER PIN GONE TOO (2026-09-07), THIS PANEL NO LONGER DECIDES ANYTHING
// ABOUT ANOTHER MEMBER'S MACHINE AT ALL. That is why it moved off the manage gate; a reader
// finding `canManage` restored around it should treat that as a regression, not a tightening.

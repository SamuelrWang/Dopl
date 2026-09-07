// @vitest-environment jsdom
/**
 * **WHO ANSWERS *MY* UNADDRESSED MESSAGES IN THIS CHANNEL** — the per-member control
 * (2026-09-07, Samuel's ruling on items 10 and 11).
 *
 * ⚠ **THIS SUITE WAS REPLACED WHOLESALE, NOT EDITED, AND THE REASON IS WORTH KEEPING.** It
 * tested a room MANAGER's picker of ONE specific agent, plus the three posture-ceiling rows.
 * Both settings are deleted from the product — the ceiling on 2026-09-06 (items 12/13/14), the
 * responder pin here — so every property it pinned is about behaviour that no longer exists.
 * Rewriting the assertions to "pass" against the new control would have been the worst of both:
 * a suite that looks like coverage and asserts nothing anybody ruled.
 *
 * ⚠ **WHAT THE OLD SUITE PROVED, AND WHY NONE OF IT SURVIVES:**
 *  - *A nomination must not look cleared when its agent is asleep* — there is no nomination.
 *    The setting is a two-value RULE precisely because agents are EPHEMERAL and a stored handle
 *    decays into naming nothing; that decay was the defect, not an implementation detail.
 *  - *`null` is a value, not an absence* — there is no clear. The column is `NOT NULL` with two
 *    values, and `last_addressed` IS the unconfigured answer (B1, 2026-09-04), so "no opinion"
 *    is not a state a member can be in.
 *  - *No dead rows* — SURVIVES, and it is the one property below that carries over, because the
 *    audience changed: the slot is gated on MEMBERSHIP now, not on manage.
 *
 * The properties that fail QUIETLY, which is what this file is for now:
 *
 *  - **THE CONTROL AND THE COMPOSER'S LINE MUST READ ONE SOURCE.** Both ask
 *    `viewerUnaddressedResponder` of the roster; a control that read the setting differently
 *    would show a person something the server does not honour, with no way to tell.
 *  - **AN UNLOADED ROSTER RENDERS AS THE DEFAULT, NEVER AS "No one".** The fail-safe direction
 *    is the ruling: `"none"` is a claim that this person's untagged messages reach nobody.
 *  - **A PEER'S SCRUBBED `null` IS NOT A SETTING.** `mapMemberRow` nulls the field on every row
 *    but the viewer's; reading one as "they chose nobody" is the privacy scrub being mistaken
 *    for data.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelAgentsSettings } from "./settings-channel-agents";
import { ChannelsV2SettingsTab } from "./settings-tab";
import { channel as channelFixture, member, ME, PEER } from "./test-fixtures";
import type { ChannelMember } from "../../types";

afterEach(cleanup);

const CONTROL = "Who answers my unaddressed messages in this channel";

/** ⚠ The viewer's row FIRST and a peer's row after it, because the control must pick the
 *  viewer's by user id rather than by position — the bug a one-row fixture cannot catch. */
function roster(mine: Partial<ChannelMember> = {}): ChannelMember[] {
  return [
    member({ userId: PEER, displayName: "Diana Taylor", unaddressedResponder: null }),
    member({ userId: ME, ...mine }),
  ];
}

function panel(
  over: {
    members?: ChannelMember[];
    onSetUnaddressedResponder?: (s: "none" | "last_addressed") => void;
  } = {}
) {
  render(
    <ChannelAgentsSettings
      members={over.members ?? roster()}
      currentUserId={ME}
      onSetUnaddressedResponder={over.onSetUnaddressedResponder ?? (() => {})}
    />
  );
}

/** Open a `SelectMenu` by its accessible name and return its option buttons. */
function open(ariaLabel: string): HTMLElement[] {
  fireEvent.click(screen.getByLabelText(ariaLabel));
  return screen.getAllByRole("menuitem");
}

describe("the per-member responder rule", () => {
  it("offers EXACTLY two options, and no way to name an agent", () => {
    panel();
    const labels = open(CONTROL).map((el) => el.textContent ?? "");
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.includes("No one"))).toBe(true);
    expect(labels.some((l) => l.includes("Last Agent Addressed"))).toBe(true);
  });

  it("🔒 shows the VIEWER's row, not the first row or a peer's", () => {
    // ⚠ The peer's row sorts first and carries the scrubbed `null`. Reading position 0 would
    // render the default here and look correct — which is why the viewer's choice is `none`.
    panel({ members: roster({ unaddressedResponder: "none" }) });
    expect(screen.getByLabelText(CONTROL).textContent).toContain("No one");
  });

  it("🔒 an unloaded roster renders the DEFAULT, never 'No one'", () => {
    // The failure this forbids is silent and invisible to its victim: a person who never opened
    // this panel being shown, and then treated as, having opted out.
    panel({ members: [] });
    expect(screen.getByLabelText(CONTROL).textContent).toContain("Last Agent Addressed");
  });

  it("sends the SETTING, not a handle and not null", () => {
    const onSetUnaddressedResponder = vi.fn();
    panel({ onSetUnaddressedResponder });
    const items = open(CONTROL);
    fireEvent.click(items.find((el) => el.textContent?.includes("No one"))!);
    expect(onSetUnaddressedResponder).toHaveBeenCalledWith("none");
  });

  it("sends `last_addressed` for the default option, spelled as the shared constant", () => {
    const onSetUnaddressedResponder = vi.fn();
    panel({ members: roster({ unaddressedResponder: "none" }), onSetUnaddressedResponder });
    const items = open(CONTROL);
    fireEvent.click(items.find((el) => el.textContent?.includes("Last Agent Addressed"))!);
    expect(onSetUnaddressedResponder).toHaveBeenCalledWith("last_addressed");
  });
});

describe("NO DEAD ROWS — the tab shows the panel only when it is given one", () => {
  it("renders the panel when the host passes it", () => {
    render(
      <ChannelsV2SettingsTab
        channel={channelFixture()}
        canManage
        channelAgents={<div>channel agent settings</div>}
        onInvite={() => {}}
        onToggleVisibility={() => {}}
        onToggleArchive={() => {}}
        onRequestDelete={() => {}}
        onRequestLeave={() => {}}
      />
    );
    expect(screen.getByText("channel agent settings")).toBeTruthy();
  });

  /**
   * 🔒 **A NON-MANAGER MEMBER NOW GETS THIS PANEL, AND THAT IS THE RULING.**
   *
   * ⚠ The slot was `null` for a non-manager until 2026-09-07, correctly: it held decisions
   * about OTHER members' agents. It holds a personal setting now, so gating it on manage would
   * hide it from every non-manager in the room while the server went on honouring the value —
   * a control that shows half of what it governs. `channel-manage.tsx` gates on
   * `channel.isMember`; this asserts the tab renders what that gate passes it.
   */
  it("🔒 renders for a non-manager MEMBER — the gate is membership, not manage", () => {
    render(
      <ChannelsV2SettingsTab
        channel={{ ...channelFixture(), role: "member" }}
        canManage={false}
        channelAgents={<div>channel agent settings</div>}
        onInvite={() => {}}
        onToggleVisibility={() => {}}
        onToggleArchive={() => {}}
        onRequestDelete={() => {}}
        onRequestLeave={() => {}}
      />
    );
    expect(screen.getByText("channel agent settings")).toBeTruthy();
  });

  it("a NON-MEMBER with nothing else to manage still gets the EMPTY STATE", () => {
    // ⚠ `channelAgents` is `null` for them (`channel-manage.tsx` gates it on `isMember`: there
    // is no membership row to set anything on), and the empty state must not become a heading
    // over nothing.
    render(
      <ChannelsV2SettingsTab
        channel={{ ...channelFixture(), isMember: false, role: null }}
        canManage={false}
        memberManagement={false}
        onInvite={() => {}}
        onToggleVisibility={() => {}}
        onToggleArchive={() => {}}
        onRequestDelete={() => {}}
        onRequestLeave={() => {}}
      />
    );
    expect(screen.getByText("Nothing to manage")).toBeTruthy();
  });
});

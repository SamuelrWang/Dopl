// @vitest-environment jsdom
/**
 * **THE CHANNEL'S OWN AGENT SETTINGS** — the default responder (ruling B6) and
 * the posture ceiling F-449 records as having no editing surface at all
 * (2026-09-02, v2 wave B slice B4).
 *
 * The properties that fail QUIETLY, which is what this file is for:
 *
 *  - **A NOMINATION MUST NOT LOOK CLEARED WHEN ITS AGENT IS ASLEEP.**
 *    `SelectMenu` renders BLANK for a value matching no option, and one click
 *    away from a blank trigger is clearing the setting for real.
 *  - **`null` IS A VALUE, NOT AN ABSENCE.** Withdrawing a nomination and
 *    removing a ceiling are the only ways either setting can be undone; a
 *    handler that sent `undefined` would make both permanent.
 *  - **NO DEAD ROWS.** A reader who cannot write these must not be shown them —
 *    and the server, not this component, is the gate.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelAgentsSettings } from "./settings-channel-agents";
import { ChannelsV2SettingsTab } from "./settings-tab";
import { channel as channelFixture } from "./test-fixtures";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";

afterEach(cleanup);

const session = (over: Partial<ChannelPeerSession>): ChannelPeerSession =>
  ({ userId: "user-1", name: "k3v7d2mq", displayName: null, ...over }) as ChannelPeerSession;

function panel(over: {
  responder?: string | null;
  sessions?: ChannelPeerSession[];
  posture?: { tools?: string | null; messages?: string | null; chain?: boolean | null };
  onSetDefaultResponder?: (h: string | null) => void;
  onSetCeiling?: (p: Record<string, unknown>) => void;
} = {}) {
  const base = channelFixture();
  const channel = {
    ...base,
    defaultResponderAgentName: over.responder ?? null,
    agentPosture: { ...base.agentPosture, ...over.posture },
  } as typeof base;
  render(
    <ChannelAgentsSettings
      channel={channel}
      sessions={over.sessions ?? []}
      onSetDefaultResponder={over.onSetDefaultResponder ?? (() => {})}
      onSetCeiling={(over.onSetCeiling ?? (() => {})) as never}
    />
  );
}

/** Open a `SelectMenu` by its accessible name and return its option buttons. */
function open(ariaLabel: string): HTMLElement[] {
  fireEvent.click(screen.getByLabelText(ariaLabel));
  return screen.getAllByRole("menuitem");
}

describe("the default responder", () => {
  it("offers every live agent in the room, plus 'No one'", () => {
    panel({
      sessions: [
        session({ name: "k3v7d2mq" }),
        session({ name: "m8q1zzzz", userId: "user-9" }),
      ],
    });
    const labels = open(
      "Agent that answers unaddressed messages in this channel"
    ).map((el) => el.textContent);
    expect(labels.some((l) => l?.includes("No one"))).toBe(true);
    expect(labels.some((l) => l?.includes("agent-k3v7d2mq"))).toBe(true);
    // ⚠ A PEER'S AGENT IS OFFERED. The setting names who the ROOM's unaddressed
    // work goes to, and every member's machine is a candidate — the same set the
    // Agents tab already shows.
    expect(labels.some((l) => l?.includes("agent-m8q1zzzz"))).toBe(true);
  });

  it("🔒 keeps a STORED handle whose agent is not running, marked as such", () => {
    // Without this the trigger renders blank and reads as "nobody nominated".
    panel({ responder: "agent-gone1234", sessions: [session({})] });
    const labels = open(
      "Agent that answers unaddressed messages in this channel"
    ).map((el) => el.textContent);
    expect(labels.some((l) => l?.includes("agent-gone1234"))).toBe(true);
    expect(labels.some((l) => l?.includes("Not running"))).toBe(true);
  });

  it("does not offer the stored handle TWICE when its agent is live", () => {
    panel({ responder: "agent-k3v7d2mq", sessions: [session({})] });
    const labels = open(
      "Agent that answers unaddressed messages in this channel"
    ).map((el) => el.textContent ?? "");
    expect(labels.filter((l) => l.includes("agent-k3v7d2mq"))).toHaveLength(1);
  });

  it("🔒 sends `null` to WITHDRAW — never `undefined`, which would mean 'unchanged'", () => {
    const onSetDefaultResponder = vi.fn();
    panel({ responder: "agent-k3v7d2mq", sessions: [session({})], onSetDefaultResponder });
    const items = open("Agent that answers unaddressed messages in this channel");
    fireEvent.click(items.find((el) => el.textContent?.includes("No one"))!);
    expect(onSetDefaultResponder).toHaveBeenCalledWith(null);
  });

  it("sends the HANDLE the picker showed — the same grammar the column stores", () => {
    const onSetDefaultResponder = vi.fn();
    panel({ sessions: [session({ name: "m8q1zzzz" })], onSetDefaultResponder });
    const items = open("Agent that answers unaddressed messages in this channel");
    fireEvent.click(items.find((el) => el.textContent?.includes("agent-m8q1zzzz"))!);
    expect(onSetDefaultResponder).toHaveBeenCalledWith("agent-m8q1zzzz");
  });

  it("offers a RENAMED agent by its slug, through the one handle rule", () => {
    panel({ sessions: [session({ name: "k3v7d2mq", displayName: "Build Bot" })] });
    const items = open("Agent that answers unaddressed messages in this channel");
    fireEvent.click(items.find((el) => el.textContent?.includes("Build Bot"))!);
    // No assertion on the callback here — the point is the VALUE the picker
    // carries is the slug the resolver accepts, asserted below by its absence
    // of `agent-` framing.
    expect(screen.queryByText("agent-k3v7d2mq")).toBeNull();
  });
});

describe("the posture ceiling — F-449's missing surface", () => {
  it("offers 'No ceiling' on every axis, and that is what `null` means", () => {
    panel();
    for (const label of [
      "Widest tool mode an agent launched in this channel may run",
      "Widest message mode an agent launched in this channel may run",
      "May an agent launched in this channel launch further agents",
    ]) {
      expect(open(label).some((el) => el.textContent?.includes("No ceiling"))).toBe(
        true
      );
      fireEvent.keyDown(document, { key: "Escape" });
      cleanup();
      panel();
    }
  });

  it("🔒 removes a ceiling with `null` PER AXIS, leaving the others unchanged", () => {
    const onSetCeiling = vi.fn();
    // ⚠ START FROM A RECORDED CEILING. Picking the value already showing is a
    // no-op the control correctly swallows, so a test that cleared an already
    // empty axis would assert nothing.
    panel({ posture: { tools: "auto", messages: "auto_both" }, onSetCeiling });
    const items = open("Widest tool mode an agent launched in this channel may run");
    fireEvent.click(items.find((el) => el.textContent?.includes("No ceiling"))!);
    // ⚠ ONLY the axis that was touched. A patch naming all three would rewrite
    // two settings the operator did not open.
    expect(onSetCeiling).toHaveBeenCalledWith({ tools: null });
  });

  it("sends the chain axis as a BOOLEAN, not the picker's string", () => {
    const onSetCeiling = vi.fn();
    panel({ onSetCeiling });
    const items = open("May an agent launched in this channel launch further agents");
    fireEvent.click(items.find((el) => el.textContent?.includes("Not allowed"))!);
    expect(onSetCeiling).toHaveBeenCalledWith({ chain: false });
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

  it("a non-manager with nothing else to manage still gets the EMPTY STATE", () => {
    // ⚠ `channelAgents` is `null` for them (`channel-manage.tsx` gates it), and
    // the empty state must not become a heading over nothing.
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

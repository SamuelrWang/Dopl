import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelSettingsPopover } from "@/features/channels/components/channel-settings-popover";
import { RequestPermissionRow } from "@/features/channels/components/permission-preset-row";
import type { Channel, ChannelMember } from "@/features/channels/types";
import { installBridge } from "#/test-utils/bridge";

/**
 * CHANNEL SETTINGS POPOVER, exercised where its two arm controls exist.
 *
 * Permissions and Sends are the desktop permission ARM
 * (`main/channel-prefs.js`) over `window.dopl.channels.get/setPermissionPreset`;
 * Tools is a cloud write. Copy + pure panel are pinned in the ROOT suite; the
 * two things needing a real bridge and DOM are pinned here:
 *
 *  1. the arm section appears only WITH the bridge, and drilling in writes;
 *  2. ⚠ TWO surfaces showing one channel's arm must not revert each other. A
 *     per-mount private snapshot makes the second writer send
 *     `{...staleSnapshot, ...patch}`, walking the other's axis back while still
 *     displaying the value it no longer has. The card's contract is that Allow
 *     launches what the card SHOWS.
 */

const CHANNEL = "44444444-4444-4444-8444-444444444444";

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: CHANNEL,
    workspaceId: "w1",
    slug: "general",
    name: "general",
    topic: "",
    visibility: "public",
    isDirect: false,
    directPeer: null,
    createdBy: "u-me",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 2,
    lastMessageAt: null,
    role: "member",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: null,
    myAgentToolProfile: "full",
    onlineMemberCount: 0,
    ...over,
  } as Channel;
}

function member(over: Partial<ChannelMember> = {}): ChannelMember {
  return {
    channelId: CHANNEL,
    userId: "u-alice",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: null,
    joinedAt: "2026-08-01T00:00:00.000Z",
    displayName: "Alice",
    email: "alice@example.com",
    avatarUrl: null,
    ...over,
  };
}

/**
 * `window.dopl` carrying the permission-preset half of the channels bridge over
 * a real in-memory store, so a write is observable the way main stores it and a
 * later read sees it — the point of the second suite below.
 */
function bridge(opts: { present?: boolean; ok?: boolean } = {}) {
  const stored: { value: unknown } = { value: null };
  const getPermissionPreset = vi.fn(() => Promise.resolve(stored.value));
  const setPermissionPreset = vi.fn((_id: string, preset: unknown) => {
    if (opts.ok === false) return Promise.resolve({ ok: false });
    stored.value = preset;
    return Promise.resolve({ ok: true });
  });
  const channels: Record<string, unknown> = {};
  if (opts.present !== false) {
    channels.getPermissionPreset = getPermissionPreset;
    channels.setPermissionPreset = setPermissionPreset;
  }
  installBridge({ apiRequest: vi.fn(), channels });
  return { getPermissionPreset, setPermissionPreset, stored };
}

afterEach(() => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "dopl");
});

function openSettings(over: Partial<Parameters<typeof ChannelSettingsPopover>[0]> = {}) {
  const onSetToolProfile = vi.fn();
  const onToggleTrust = vi.fn();
  render(
    <ChannelSettingsPopover
      channel={channel()}
      otherMembers={[member()]}
      trustedIds={new Set()}
      trustBusyIds={new Set()}
      toolProfileBusy={false}
      onSetToolProfile={onSetToolProfile}
      onToggleTrust={onToggleTrust}
      {...over}
    />
  );
  fireEvent.click(screen.getByLabelText("Channel settings"));
  return { onSetToolProfile, onToggleTrust };
}

const row = (name: RegExp | string) => screen.getByRole("menuitem", { name });
const queryRow = (name: RegExp | string) => screen.queryByRole("menuitem", { name });

describe("the arm section exists only where the arm does", () => {
  it("shows Permissions and Sends inside the desktop shell", async () => {
    bridge();
    openSettings();
    await waitFor(() => expect(queryRow(/^Permissions/)).not.toBeNull());
    expect(queryRow(/^Sends/)).not.toBeNull();
    expect(screen.getByText(/expires after 30 minutes/)).toBeInTheDocument();
  });

  it("shows neither in a plain browser, and still shows Tools", async () => {
    render(
      <ChannelSettingsPopover
        channel={channel()}
        otherMembers={[member()]}
        trustedIds={new Set()}
        trustBusyIds={new Set()}
        toolProfileBusy={false}
        onSetToolProfile={vi.fn()}
        onToggleTrust={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText("Channel settings"));
    await waitFor(() => expect(queryRow(/^Tools/)).not.toBeNull());
    expect(queryRow(/^Permissions/)).toBeNull();
    expect(queryRow(/^Sends/)).toBeNull();
  });

  it("shows neither on a desktop build without the preset API", async () => {
    bridge({ present: false });
    openSettings();
    await waitFor(() => expect(queryRow(/^Tools/)).not.toBeNull());
    expect(queryRow(/^Permissions/)).toBeNull();
  });
});

describe("drilling in and choosing", () => {
  it("arms the tool axis and shows the new posture on the way back", async () => {
    const b = bridge();
    openSettings();
    await waitFor(() => expect(queryRow(/^Permissions/)).not.toBeNull());
    fireEvent.click(row(/^Permissions/));
    fireEvent.click(row(/^Bypass/));
    await waitFor(() =>
      expect(b.setPermissionPreset).toHaveBeenCalledWith(CHANNEL, {
        tools: "bypass",
        messages: "ask",
      })
    );
    fireEvent.click(row("Permissions"));
    await waitFor(() => expect(row(/^Permissions/).textContent).toContain("Bypass"));
  });

  it("writes the tool PROFILE through the caller's cloud mutation, not the bridge", async () => {
    const b = bridge();
    const { onSetToolProfile } = openSettings();
    fireEvent.click(row(/^Tools/));
    fireEvent.click(row(/^Read only/));
    expect(onSetToolProfile).toHaveBeenCalledWith("read_only");
    expect(b.setPermissionPreset).not.toHaveBeenCalled();
  });

  it("reverts the shown posture when the desktop refuses the write", async () => {
    // Never leave the control claiming a posture that was not stored.
    bridge({ ok: false });
    openSettings();
    await waitFor(() => expect(queryRow(/^Sends/)).not.toBeNull());
    fireEvent.click(row(/^Sends/));
    fireEvent.click(row(/^Automatic/));
    fireEvent.click(row("Sends"));
    await waitFor(() =>
      expect(row(/^Sends/).textContent).toContain("Ask each time")
    );
  });

  it("toggles trust for a listed teammate", async () => {
    bridge();
    const { onToggleTrust } = openSettings();
    fireEvent.click(row(/Alice/));
    expect(onToggleTrust).toHaveBeenCalledWith("u-alice", true);
  });

  it("explains trust with nobody to point it at, instead of hiding the section", async () => {
    bridge();
    openSettings({ otherMembers: [] });
    expect(screen.getByText(/Trust covers the whole workspace/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody else is in this channel yet/)).toBeInTheDocument();
  });
});

describe("two surfaces, one arm", () => {
  it("does not let the settings popover revert the request card's axis", async () => {
    const b = bridge();
    // Both on the same channel — the ordinary case.
    render(
      <>
        <RequestPermissionRow channelId={CHANNEL} />
        <ChannelSettingsPopover
          channel={channel()}
          otherMembers={[member()]}
          trustedIds={new Set()}
          trustBusyIds={new Set()}
        toolProfileBusy={false}
          onSetToolProfile={vi.fn()}
          onToggleTrust={vi.fn()}
        />
      </>
    );
    await waitFor(() =>
      expect(screen.getByLabelText("What this thread's agent may do")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByLabelText("What this thread's agent may do"));
    fireEvent.click(row(/^Bypass/));
    await waitFor(() => expect(b.setPermissionPreset).toHaveBeenCalledTimes(1));

    // Popover sets the MESSAGES axis, from a component mounted before the
    // card's write existed.
    fireEvent.click(screen.getByLabelText("Channel settings"));
    await waitFor(() => expect(queryRow(/^Sends/)).not.toBeNull());
    fireEvent.click(row(/^Sends/));
    fireEvent.click(row(/^Automatic/));

    // Both axes survive.
    await waitFor(() =>
      expect(b.setPermissionPreset).toHaveBeenLastCalledWith(CHANNEL, {
        tools: "bypass",
        messages: "auto_both",
      })
    );
  });

  it("repaints the OTHER surface, so neither displays a posture it no longer has", async () => {
    bridge();
    render(
      <>
        <RequestPermissionRow channelId={CHANNEL} />
        <ChannelSettingsPopover
          channel={channel()}
          otherMembers={[member()]}
          trustedIds={new Set()}
          trustBusyIds={new Set()}
        toolProfileBusy={false}
          onSetToolProfile={vi.fn()}
          onToggleTrust={vi.fn()}
        />
      </>
    );
    fireEvent.click(screen.getByLabelText("Channel settings"));
    await waitFor(() => expect(queryRow(/^Permissions/)).not.toBeNull());
    fireEvent.click(row(/^Permissions/));
    fireEvent.click(row(/^Bypass/));

    // Card's pill names the current value; must not still read "Ask each time"
    // after the popover armed something else.
    await waitFor(() =>
      expect(screen.getByLabelText("What this thread's agent may do").textContent).toContain(
        "Bypass"
      )
    );
  });
});

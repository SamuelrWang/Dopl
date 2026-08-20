import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelAgentSettings } from "@/features/channels/components/channels-v2/settings-agent";
import { RequestPermissionRow } from "@/features/channels/components/permission-preset-row";
import type { ChannelMember } from "@/features/channels/types";
import { installBridge } from "#/test-utils/bridge";

/**
 * THE SETTINGS TAB'S AGENT HALF, exercised where its desktop-only controls
 * exist.
 *
 * ⚠ THIS FILE REPLACES `channel-settings-popover.test.tsx`, deleted with the
 * popover on 2026-08-19 (Samuel, live review — every setting inline). The rules
 * did not go with the chrome, and they are the same two the popover suite was
 * written for:
 *
 *  1. the arm section and the folder row exist ONLY with their bridge, and
 *     choosing a mode WRITES through it;
 *  2. ⚠ TWO surfaces showing one channel's arm must not revert each other. A
 *     per-mount private snapshot makes the second writer send
 *     `{...staleSnapshot, ...patch}`, walking the other's axis back while still
 *     displaying the value it no longer has. The launch panel's contract is that
 *     the launch runs what it SHOWS.
 *
 * Permissions and Sends are the desktop permission ARM (`main/channel-prefs.js`)
 * over `window.dopl.channels.get/setPermissionPreset`; the folder is
 * `window.dopl.channels.chooseFolder/clearFolder`; Tools is a CLOUD write and
 * belongs to the caller. Copy and the bridge-free rendering are pinned in the
 * ROOT suite (`channels-v2/settings-tab.test.tsx`); what needs a real bridge and
 * a real DOM is here.
 *
 * ⚠ THE TAB'S EXPLAINER COPY WAS CUT ON 2026-08-19 (Samuel, live review, third
 * ruling of the day — "we should not be explaining everything to the user").
 * The two assertions below that pinned a paragraph now pin its ABSENCE plus the
 * heading or short line that replaced it. **Behaviour is untouched:** every
 * bridge gate, write and busy guard in this file is the same one.
 */

const CHANNEL = "44444444-4444-4444-8444-444444444444";

function member(over: Partial<ChannelMember> = {}): ChannelMember {
  return {
    channelId: CHANNEL,
    userId: "u-alice",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
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
 * later read sees it — the point of the last suite below. `folder: true` adds
 * the folder half, feature-detected on `chooseFolder`.
 */
function bridge(opts: { present?: boolean; ok?: boolean; folder?: boolean } = {}) {
  const stored: { value: unknown } = { value: null };
  const getPermissionPreset = vi.fn(() => Promise.resolve(stored.value));
  const setPermissionPreset = vi.fn((_id: string, preset: unknown) => {
    if (opts.ok === false) return Promise.resolve({ ok: false });
    stored.value = preset;
    return Promise.resolve({ ok: true });
  });
  const getFolderLabel = vi.fn(() => Promise.resolve<string | null>("~/Downloads/repo"));
  const chooseFolder = vi.fn(() => Promise.resolve<string | null>("~/code/dopl"));
  const clearFolder = vi.fn(() => Promise.resolve());
  const channels: Record<string, unknown> = {};
  if (opts.present !== false) {
    channels.getPermissionPreset = getPermissionPreset;
    channels.setPermissionPreset = setPermissionPreset;
  }
  if (opts.folder) {
    channels.getFolderLabel = getFolderLabel;
    channels.chooseFolder = chooseFolder;
    channels.clearFolder = clearFolder;
  }
  installBridge({ apiRequest: vi.fn(), channels });
  return { getPermissionPreset, setPermissionPreset, chooseFolder, clearFolder, stored };
}

afterEach(() => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "dopl");
});

function mountAgent(over: Partial<Parameters<typeof ChannelAgentSettings>[0]> = {}) {
  const onSetToolProfile = vi.fn();
  const onToggleTrust = vi.fn();
  render(
    <ChannelAgentSettings
      channelId={CHANNEL}
      profile="full"
      otherMembers={[member()]}
      trustedIds={new Set()}
      trustBusyIds={new Set()}
      toolProfileBusy={false}
      onSetToolProfile={onSetToolProfile}
      onToggleTrust={onToggleTrust}
      {...over}
    />
  );
  return { onSetToolProfile, onToggleTrust };
}

const permissions = () =>
  screen.getByLabelText("Permissions for the next request you allow");
const sends = () => screen.getByLabelText("Sends for the next request you allow");
const queryPermissions = () =>
  screen.queryByLabelText("Permissions for the next request you allow");
const item = (name: RegExp | string) => screen.getByRole("menuitem", { name });

describe("the arm section exists only where the arm does", () => {
  it("shows Permissions and Sends inside the desktop shell", async () => {
    bridge();
    mountAgent();
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    expect(sends()).toBeInTheDocument();
    // ⚠ The HEADING is what says this is an arm, and since the 2026-08-19
    // minimal-copy ruling it is the only thing that does — the "expires after
    // 30 minutes" sentence under it was cut with every other explainer on this
    // tab. The TTL is unchanged; the root suite still cross-checks it against
    // `main/channel-prefs.js`.
    expect(screen.getByText("For the next request you allow")).toBeInTheDocument();
    expect(screen.queryByText(/expires after 30 minutes/)).toBeNull();
  });

  it("shows neither in a plain browser, and still shows Tools", async () => {
    mountAgent();
    await waitFor(() =>
      expect(screen.getByRole("radiogroup", { name: "Tools" })).toBeInTheDocument()
    );
    expect(queryPermissions()).toBeNull();
    expect(
      screen.queryByLabelText("Sends for the next request you allow")
    ).toBeNull();
    // ⚠ No heading over nothing either.
    expect(screen.queryByText("For the next request you allow")).toBeNull();
  });

  it("shows neither on a desktop build without the preset API", async () => {
    bridge({ present: false });
    mountAgent();
    await waitFor(() =>
      expect(screen.getByRole("radiogroup", { name: "Tools" })).toBeInTheDocument()
    );
    expect(queryPermissions()).toBeNull();
  });
});

describe("choosing, inline", () => {
  it("arms the tool axis and shows the new posture on the control itself", async () => {
    const b = bridge();
    mountAgent();
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    fireEvent.click(permissions());
    fireEvent.click(item(/^Bypass/));
    await waitFor(() =>
      expect(b.setPermissionPreset).toHaveBeenCalledWith(CHANNEL, {
        tools: "bypass",
        messages: "ask",
      })
    );
    // ⚠ No drill-back: the value is on the row the whole time.
    await waitFor(() => expect(permissions().textContent).toContain("Bypass"));
  });

  it("writes the tool PROFILE through the caller's cloud mutation, not the bridge", async () => {
    const b = bridge();
    const { onSetToolProfile } = mountAgent();
    fireEvent.click(screen.getByRole("radio", { name: /Read only/ }));
    expect(onSetToolProfile).toHaveBeenCalledWith("read_only");
    expect(b.setPermissionPreset).not.toHaveBeenCalled();
  });

  it("reverts the shown posture when the desktop refuses the write", async () => {
    // Never leave the control claiming a posture that was not stored.
    bridge({ ok: false });
    mountAgent();
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    fireEvent.click(sends());
    fireEvent.click(item(/^Automatic/));
    await waitFor(() => expect(sends().textContent).toContain("Ask each time"));
  });

  it("toggles trust for a listed teammate", async () => {
    bridge();
    const { onToggleTrust } = mountAgent();
    fireEvent.click(screen.getByRole("switch", { name: "Always allow Alice" }));
    expect(onToggleTrust).toHaveBeenCalledWith("u-alice", true);
  });

  it("keeps the trust section with nobody to point it at, instead of hiding it", async () => {
    bridge();
    mountAgent({ otherMembers: [] });
    // ⚠ One short line each (Samuel, 2026-08-19 — minimal copy). The scope
    // survived the cut because a per-CHANNEL tab cannot leave workspace-wide
    // implicit; the two-sentence scope/effect paragraph did not.
    expect(screen.getByText("Applies across the whole workspace")).toBeInTheDocument();
    expect(screen.getByText("Nobody else in this channel yet")).toBeInTheDocument();
    expect(screen.queryByText(/Trust covers the whole workspace/)).toBeNull();
  });
});

describe("the Agent folder row", () => {
  it("is absent without the folder half of the bridge", async () => {
    bridge();
    mountAgent();
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    expect(screen.queryByText("Agent folder")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change folder…" })).toBeNull();
  });

  it("shows the bridge's abbreviated label and drives both actions", async () => {
    const b = bridge({ folder: true });
    mountAgent();
    await waitFor(() =>
      expect(screen.getByText("~/Downloads/repo")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));
    await waitFor(() => expect(b.chooseFolder).toHaveBeenCalledWith(CHANNEL));
    await waitFor(() => expect(screen.getByText("~/code/dopl")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(b.clearFolder).toHaveBeenCalledWith(CHANNEL));
    // ⚠ Back to the default folder — and "Use default" goes with it, because
    // there is nothing left to reset.
    await waitFor(() =>
      expect(screen.getByText("Sandbox (default)")).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Use default" })).toBeNull();
  });
});

describe("two surfaces, one arm", () => {
  it("does not let the Settings tab revert the launch panel's axis", async () => {
    const b = bridge();
    // Both on the same channel — the ordinary case.
    render(
      <>
        <RequestPermissionRow channelId={CHANNEL} />
        <ChannelAgentSettings
          channelId={CHANNEL}
          profile="full"
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
    fireEvent.click(item(/^Bypass/));
    await waitFor(() => expect(b.setPermissionPreset).toHaveBeenCalledTimes(1));

    // The tab sets the MESSAGES axis, from a component mounted before the
    // panel's write existed.
    fireEvent.click(sends());
    fireEvent.click(item(/^Automatic/));

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
        <ChannelAgentSettings
          channelId={CHANNEL}
          profile="full"
          otherMembers={[member()]}
          trustedIds={new Set()}
          trustBusyIds={new Set()}
          toolProfileBusy={false}
          onSetToolProfile={vi.fn()}
          onToggleTrust={vi.fn()}
        />
      </>
    );
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    fireEvent.click(permissions());
    fireEvent.click(item(/^Bypass/));

    // The panel's pill names the current value; must not still read "Ask each
    // time" after the tab armed something else.
    await waitFor(() =>
      expect(screen.getByLabelText("What this thread's agent may do").textContent).toContain(
        "Bypass"
      )
    );
  });
});

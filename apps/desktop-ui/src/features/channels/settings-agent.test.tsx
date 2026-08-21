import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelAgentSettings } from "@/features/channels/components/channels-v2/settings-agent";
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
 *  1. the permission section and the folder row exist ONLY with their bridge,
 *     and choosing a mode WRITES through it;
 *  2. ⚠ TWO surfaces showing one channel's pair must not revert each other. A
 *     per-mount private snapshot makes the second writer send
 *     `{...staleSnapshot, ...patch}`, walking the other's axis back while still
 *     displaying the value it no longer has.
 *
 * ⚠ WHAT THESE ROWS WRITE CHANGED ON 2026-08-20. Permissions and Sends on THIS
 * tab wrote the single-use consent ARM; they write the DURABLE LAUNCH POSTURE now
 * (`window.dopl.channels.get/setLaunchPosture`, stored under
 * `channelLaunchPosture` in `main/channel-prefs.js`), consumed by exactly one
 * caller — `channel-dir-ipc.js › sessions:launch`, the Agents tab's own button.
 *
 * The defect that forced it: the tab rendered a FUSE among durable settings (tool
 * profile, folder, auto-send). The operator picked Bypass, the first
 * consent-approved launch spent it, every later session started manual/ask — and
 * the control went on displaying "Bypass", because it re-reads only on mount.
 *
 * ⚠ AND THEN THE ARM WAS DELETED OUTRIGHT, LATER THE SAME DAY (Samuel's ruling,
 * F-233): when it "went back to the request card" it went nowhere, because that
 * card's inbound branch had already stopped rendering. So the two-records suite
 * below is now ONE record with TWO READERS — the tab in the main window and in a
 * pop-out — which is where rule 2 always mattered most and is the only place it
 * can still be driven.
 *
 * The folder is `window.dopl.channels.chooseFolder/clearFolder`; Tools is a CLOUD
 * write and belongs to the caller. Copy and the bridge-free rendering are pinned
 * in the ROOT suite (`channels-v2/settings-agent-posture.test.tsx` and
 * `› settings-tab.test.tsx`); what needs a real bridge and a real DOM is here.
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
 * `window.dopl` carrying the channels bridge over a real in-memory store, so a
 * write is observable the way main stores it and a later read sees it — the point
 * of the last suite below. `folder: true` adds the folder half, feature-detected
 * on `chooseFolder`.
 *
 * ⚠ ONE STORE NOW, AND THAT IS NOT A RELAXATION. This carried TWO — the single-use
 * ARM (`channelPermissionPresets`) beside the DURABLE posture
 * (`channelLaunchPosture`) — because the 2026-08-20 split existed to stop a
 * Settings-tab pick being spent by a consent launch. The arm was then DELETED
 * outright (F-233: its web controls had not rendered since the 2026-08-18 consent
 * rewrite, so nothing could set it), and its two bridge ops went from the preload
 * with it. There is one permission record left, so a second fake store would be
 * mocking a surface that does not exist.
 *
 * ⚠ THE FAKE MUST NOT BE WIDER THAN THE REAL BRIDGE. It was, for a day: it kept
 * offering `get/setPermissionPreset` after the preload dropped them, which cannot
 * catch a regression — it can only assert about a world that is gone.
 */
function bridge(opts: { present?: boolean; ok?: boolean; folder?: boolean } = {}) {
  // ⚠ THE ARM'S TWO OPS STOOD HERE AND ARE GONE (2026-08-20). This fake exposed
  // `get/setPermissionPreset` on `window.dopl.channels` — ops the real preload
  // DELETED with the arm — and two cases asserted the Settings tab did not call
  // them. A test double WIDER than the surface it stands in cannot catch a
  // regression; it can only assert about a world that no longer exists.
  const posture: { value: unknown } = { value: null };
  const getLaunchPosture = vi.fn(() => Promise.resolve(posture.value));
  const setLaunchPosture = vi.fn((_id: string, next: unknown) => {
    if (opts.ok === false) return Promise.resolve({ ok: false });
    posture.value = next;
    return Promise.resolve({ ok: true });
  });
  const getFolderLabel = vi.fn(() => Promise.resolve<string | null>("~/Downloads/repo"));
  const chooseFolder = vi.fn(() => Promise.resolve<string | null>("~/code/dopl"));
  const clearFolder = vi.fn(() => Promise.resolve());
  const channels: Record<string, unknown> = {};
  if (opts.present !== false) {
    channels.getLaunchPosture = getLaunchPosture;
    channels.setLaunchPosture = setLaunchPosture;
  }
  if (opts.folder) {
    channels.getFolderLabel = getFolderLabel;
    channels.chooseFolder = chooseFolder;
    channels.clearFolder = clearFolder;
  }
  installBridge({ apiRequest: vi.fn(), channels });
  return {
    getLaunchPosture, setLaunchPosture, posture,
    chooseFolder, clearFolder,
  };
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

// The SETTINGS TAB's two selects. ⚠ They read the DURABLE posture since
// 2026-08-20; the arm's labels below belong to the REQUEST CARD alone.
const permissions = () => screen.getByLabelText("Permissions for agents you launch");
const sends = () => screen.getByLabelText("Sends for agents you launch");
const queryPermissions = () =>
  screen.queryByLabelText("Permissions for agents you launch");
// ⚠ `armTools()` STOOD HERE — the request card's ARM select, reached by the label
// "What this thread's agent may do". The arm is deleted (2026-08-20, F-233) and the
// label belongs to nothing; the two selects this file drives are both above.
const item = (name: RegExp | string) => screen.getByRole("menuitem", { name });

describe("the posture section exists only where the bridge does", () => {
  it("shows Permissions and Sends inside the desktop shell", async () => {
    bridge();
    mountAgent();
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    expect(sends()).toBeInTheDocument();
    // ⚠ THE HEADING NAMES THE ACT, NOT A TIME WINDOW (2026-08-20). It read
    // "For the next request you allow" — the ARM's heading — while these rows
    // wrote the arm, and it was carrying the whole single-use disclosure on its
    // own. It could not: the rows sit among durable settings, so the operator
    // read them as one. The rows are durable now and the arm's heading belongs
    // to the request card alone.
    expect(screen.getByText("When you launch an agent")).toBeInTheDocument();
    expect(screen.queryByText("For the next request you allow")).toBeNull();
    expect(screen.queryByText(/expires after 30 minutes/)).toBeNull();
  });

  it("shows neither in a plain browser, and still shows Tools", async () => {
    mountAgent();
    await waitFor(() =>
      expect(screen.getByRole("radiogroup", { name: "Tools" })).toBeInTheDocument()
    );
    expect(queryPermissions()).toBeNull();
    expect(screen.queryByLabelText("Sends for agents you launch")).toBeNull();
    // ⚠ No heading over nothing either.
    expect(screen.queryByText("When you launch an agent")).toBeNull();
  });

  it("shows neither on a desktop build without the posture API", async () => {
    bridge({ present: false });
    mountAgent();
    await waitFor(() =>
      expect(screen.getByRole("radiogroup", { name: "Tools" })).toBeInTheDocument()
    );
    expect(queryPermissions()).toBeNull();
  });
});

describe("choosing, inline", () => {
  it("sets the tool axis and shows the new posture on the control itself", async () => {
    const b = bridge();
    mountAgent();
    await waitFor(() => expect(queryPermissions()).not.toBeNull());
    fireEvent.click(permissions());
    fireEvent.click(item(/^Bypass/));
    await waitFor(() =>
      expect(b.setLaunchPosture).toHaveBeenCalledWith(CHANNEL, {
        tools: "bypass",
        messages: "ask",
      })
    );
    // ⚠ The "does not touch the ARM" pair that stood here is gone with the arm's
    // bridge ops (2026-08-20). There is no second permission record left to
    // overwrite, so the property is structural rather than asserted.
    // ⚠ No drill-back: the value is on the row the whole time.
    await waitFor(() => expect(permissions().textContent).toContain("Bypass"));
  });

  it("writes the tool PROFILE through the caller's cloud mutation, not the bridge", async () => {
    const b = bridge();
    const { onSetToolProfile } = mountAgent();
    fireEvent.click(screen.getByRole("radio", { name: /Read only/ }));
    expect(onSetToolProfile).toHaveBeenCalledWith("read_only");
    expect(b.setLaunchPosture).not.toHaveBeenCalled();
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

describe("ONE record, two readers — the merge rule, end to end", () => {
  // ⚠ THIS DESCRIBE LOST ITS FIRST CASE ON 2026-08-20 (Samuel's ruling, F-233).
  // "keeps the Settings tab and the request card on SEPARATE records" rendered
  // `RequestPermissionRow` beside the tab and asserted the two never cross-wrote:
  // the card armed a single-use pair for the next request a human ALLOWED, the tab
  // set a durable posture for launches that human STARTED, and each store held only
  // what its own surface put there.
  //
  // ⚠ THE RULE IT PINNED IS NOT LOST — IT MOVED DOWN. Cross-writing was only ever a
  // hazard because two surfaces might share a record; with the arm deleted there is
  // ONE record, and the question becomes the one the case below asks: two readers of
  // that record must MERGE rather than clobber. `bothSurfaces()` went with the case,
  // since the card is not a surface any more.

  it("does not let one surface revert another reader of the SAME record", async () => {
    // The merge rule did not go away — it moved to where two readers really do
    // share a record: two mounts of the tab (the main window and a pop-out).
    // A private mount snapshot makes the second writer send
    // `{...staleSnapshot, ...patch}`, walking the first's axis back while still
    // displaying the value it no longer has.
    const b = bridge();
    render(
      <>
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
      expect(screen.getAllByLabelText("Permissions for agents you launch")).toHaveLength(2)
    );
    const [firstTools] = screen.getAllByLabelText("Permissions for agents you launch");
    fireEvent.click(firstTools);
    fireEvent.click(item(/^Bypass/));
    await waitFor(() => expect(b.setLaunchPosture).toHaveBeenCalledTimes(1));

    const [, secondSends] = screen.getAllByLabelText("Sends for agents you launch");
    fireEvent.click(secondSends);
    fireEvent.click(item(/^Automatic/));

    // Both axes survive — the second write merged onto what is STORED.
    await waitFor(() =>
      expect(b.setLaunchPosture).toHaveBeenLastCalledWith(CHANNEL, {
        tools: "bypass",
        messages: "auto_both",
      })
    );
  });

  it("repaints the OTHER reader, so neither displays a posture it no longer has", async () => {
    bridge();
    render(
      <>
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
      expect(screen.getAllByLabelText("Permissions for agents you launch")).toHaveLength(2)
    );
    const [firstTools] = screen.getAllByLabelText("Permissions for agents you launch");
    fireEvent.click(firstTools);
    fireEvent.click(item(/^Bypass/));
    await waitFor(() => {
      const [, second] = screen.getAllByLabelText("Permissions for agents you launch");
      expect(second.textContent).toContain("Bypass");
    });
  });
});

// @vitest-environment jsdom
/**
 * `KbChannelGrantsSection` — the settings section that decides which CHANNELS a
 * knowledge base reaches.
 *
 * Four properties, and three of them are fences rendered rather than enforced:
 *   1. THREE STATES, and the write says which one is wanted — `none` included,
 *      because absence is a state you have to be able to ASK for.
 *   2. THE GUEST-WRITE TOGGLE IS REVEALED ONLY AT `visible` AND ONLY WHEN A
 *      GUEST IS IN THE ROOM. An unloaded roster and a `workspaceRole` the
 *      payload predates BOTH read as "no guest" and HIDE it — fail-safe, never
 *      the other way round.
 *   3. `canManage` COMES OFF THE SERVER and gates the editor; everyone else
 *      gets the summary line and no controls at all.
 *   4. Dropping out of `visible` sends `guestWrite: false`, so the pen never
 *      rides along into a level that has no human audience.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ChannelMember } from "@/features/channels/types";
import type { ChannelGrantSettings } from "../client/api";

const mutateAsync = vi.fn();
let settings: ChannelGrantSettings | null;
let loading = false;
let error: string | null = null;
let roster: ChannelMember[] = [];

vi.mock("../client/hooks-channel-grants", () => ({
  useChannelGrantSettings: () => ({ data: settings, loading, error }),
  useSetChannelGrant: () => ({ mutateAsync }),
}));

vi.mock("@/features/channels/hooks/use-channel-members", () => ({
  useChannelMembers: (channelId: string | null) => ({
    // A null channel id disables the read — the bound on the roster fan.
    members: channelId ? roster : [],
    stale: false,
    refetch: vi.fn(),
  }),
}));

import { KbChannelGrantsSection } from "./kb-channel-grants-section";

function member(workspaceRole: ChannelMember["workspaceRole"]): ChannelMember {
  return { userId: `u-${workspaceRole}`, workspaceRole } as ChannelMember;
}

function base(over: Partial<ChannelGrantSettings> = {}): ChannelGrantSettings {
  return {
    canManage: true,
    channels: [
      { id: "chan-1", name: "engineering", isDirect: false },
      { id: "chan-2", name: "design", isDirect: false },
    ],
    grants: {},
    ...over,
  };
}

function renderSection() {
  return render(
    <KbChannelGrantsSection baseId="kb-1" workspaceId="ws-1" />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue(null);
  settings = base();
  loading = false;
  error = null;
  roster = [];
});

// ⚠ EXPLICIT — this suite's config does not auto-clean, and a leftover render
// turns every `queryByRole` into a multiple-match error.
afterEach(cleanup);

describe("the three states", () => {
  it("renders one row per channel with None selected when there is no grant", () => {
    renderSection();

    expect(screen.getByText("engineering")).toBeTruthy();
    expect(screen.getByText("design")).toBeTruthy();
    // Two rows × three segments.
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(6);
    // ABSENCE renders as None, not as a missing selection.
    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked.map((r) => r.textContent)).toEqual(["None", "None"]);
  });

  it("reflects a stored grant on the right row only", () => {
    settings = base({ grants: { "chan-1": { level: "agent_only", guestWrite: false } } });
    renderSection();

    const checked = screen
      .getAllByRole("radio")
      .filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked.map((r) => r.textContent)).toEqual(["Agent only", "None"]);
  });

  it("writes the chosen level for the chosen channel", async () => {
    renderSection();
    fireEvent.click(screen.getAllByRole("radio", { name: "Visible" })[1]);

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        channelId: "chan-2",
        level: "visible",
        guestWrite: false,
      })
    );
  });

  it("asks for `none` explicitly when un-sharing", async () => {
    settings = base({ grants: { "chan-1": { level: "visible", guestWrite: true } } });
    renderSection();

    fireEvent.click(screen.getAllByRole("radio", { name: "None" })[0]);

    // ⚠ `none` is a value on the wire, and `guestWrite` drops with the level —
    // the pen must not ride along into a state that has no human audience.
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        channelId: "chan-1",
        level: "none",
        guestWrite: false,
      })
    );
  });
});

describe("the guest-write reveal", () => {
  it("is HIDDEN at `visible` when nobody in the channel is a guest", () => {
    settings = base({ grants: { "chan-1": { level: "visible", guestWrite: false } } });
    roster = [member("member"), member("admin")];
    renderSection();

    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is HIDDEN when the roster has not loaded — fail-safe, not optimistic", () => {
    settings = base({ grants: { "chan-1": { level: "visible", guestWrite: false } } });
    roster = [];
    renderSection();

    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is HIDDEN when workspaceRole is null on a payload that predates the field", () => {
    // ⚠ The member-mutation ECHOes omit `workspaceRole`, and so does any cache
    // entry written before it existed. Null must read as "not a guest".
    settings = base({ grants: { "chan-1": { level: "visible", guestWrite: false } } });
    roster = [member(null)];
    renderSection();

    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is HIDDEN at `agent_only` even with a guest in the room", () => {
    // That level has no human audience at all; there is nobody to hand a pen to.
    settings = base({ grants: { "chan-1": { level: "agent_only", guestWrite: false } } });
    roster = [member("guest")];
    renderSection();

    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("is SHOWN, and OFF, at `visible` with a guest present", () => {
    settings = base({ grants: { "chan-1": { level: "visible", guestWrite: false } } });
    roster = [member("guest")];
    renderSection();

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("writes guestWrite while HOLDING the level at visible", async () => {
    settings = base({ grants: { "chan-1": { level: "visible", guestWrite: false } } });
    roster = [member("guest")];
    renderSection();

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        channelId: "chan-1",
        level: "visible",
        guestWrite: true,
      })
    );
  });
});

describe("canManage", () => {
  it("renders a read-only summary and NO controls for a non-manager", () => {
    settings = base({
      canManage: false,
      grants: { "chan-1": { level: "visible", guestWrite: false } },
    });
    renderSection();

    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(/Shared into 1 channel\./)).toBeTruthy();
  });

  it("says so plainly when a non-manager's base reaches no channel", () => {
    settings = base({ canManage: false });
    renderSection();
    expect(screen.getByText("Not shared into any channel.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("degraded reads", () => {
  it("shows the error rather than an empty editor", () => {
    settings = null;
    error = "Something went wrong";
    renderSection();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("renders nothing editable while loading", () => {
    settings = null;
    loading = true;
    renderSection();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("says there are no channels rather than drawing an empty list", () => {
    settings = base({ channels: [] });
    renderSection();
    expect(screen.getByText("No channels available.")).toBeTruthy();
  });
});

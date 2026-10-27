// @vitest-environment jsdom
// The /home Identities face: a card opens the read-only view, Edit hands the row to the host in
// the workspace it lives in, create opens the editor directly, and the Activity rail exists only
// when this machine's session feed answered.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AgentRunPresenter } from "@/shared/lib/agent-run-presenter";
import { identity } from "./identity-editor-harness";
import { IdentitiesHome, type IdentitiesHomeProps } from "./identities-home";

const SHARED = identity({ id: "id-s", name: "Intake bot", visibility: "workspace", createdBy: "user-2" });
const MINE = identity({ id: "id-p", name: "Scout", instructions: "Read the backlog first." });

const LIVE = {
  sessionId: "s1",
  channelId: "ch-1",
  threadId: "",
  name: "a1234567",
  agentId: "a1234567",
  displayName: "Scout one",
  state: "working",
  channelName: "releases",
  threadTitle: "Cut 1.7",
  identityId: "id-p",
  identityName: "Scout",
  startedAt: Date.now() - 60_000,
} as DesktopSessionSummary;

const AGENTS: AgentRunPresenter = {
  name: (s) => s.displayName ?? "New Agent",
  state: (s) => ({ label: s.state, live: s.state === "working" }),
  face: () => null,
};
const PEER = { userId: "user-2", displayName: "Priya", avatarUrl: null };
const ENDED: DesktopSessionSummary = {
  ...LIVE,
  sessionId: "s2",
  displayName: "Scout two",
  state: "ended",
  endedAt: Date.now(),
};

function mount(over: Partial<IdentitiesHomeProps> = {}) {
  const props: IdentitiesHomeProps = {
    shared: { channelName: "releases", identities: [SHARED], markerFor: () => "by Priya", canCreate: true, peers: [PEER] },
    personal: { identities: [MINE], state: { kind: "ready" }, canCreate: true },
    card: {},
    sessions: [LIVE, ENDED],
    preview: null,
    agents: AGENTS,
    runtimes: [],
    currentUserId: "user-1",
    viewerPhoto: null,
    ownerName: () => null,
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    ...over,
  };
  render(<IdentitiesHome {...props} />);
  return props;
}

afterEach(cleanup);

describe("the identities face", () => {
  it("opens a card READ-ONLY, and Edit hands the row over where it lives", async () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: /Intake bot/ }));
    const view = await screen.findByRole("dialog", { name: "Intake bot" });
    expect(within(view).getByText("by Priya")).toBeTruthy();
    // One peer plus the viewer.
    expect(within(view).getByText("2 people can wear this")).toBeTruthy();
    expect(view.querySelectorAll("input, textarea")).toHaveLength(0);
    fireEvent.click(within(view).getByRole("button", { name: "Edit" }));
    expect(props.onEdit).toHaveBeenCalledWith("container", SHARED);
  });

  it("switches the view's tabs and stays input-free on each", async () => {
    mount();
    const personal = screen.getByRole("region", { name: "Personal" });
    fireEvent.click(within(personal).getByRole("button", { name: /^Scout/ }));
    const view = await screen.findByRole("dialog", { name: "Scout" });
    expect(within(view).getByText("Read the backlog first.")).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: /Running/ }));
    expect(within(view).getByText("Scout one")).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: /Activity/ }));
    expect(within(view).getByText("Scout two")).toBeTruthy();
    expect(view.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("has ONE create button, at the end of the controls row, and it creates a personal row", () => {
    const props = mount();
    const creates = screen.getAllByRole("button", { name: "Agent Identity" });
    expect(creates).toHaveLength(1);
    const search = screen.getByRole("textbox", { name: "Search identities" });
    const row = creates[0].closest("div.flex-wrap")!;
    expect(row.contains(search)).toBe(true);
    expect(row.contains(screen.getByRole("button", { name: "Sort identities" }))).toBe(true);
    // Search, then the sort, then the create button.
    const order = [search, screen.getByRole("button", { name: "Sort identities" }), creates[0]];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(creates[0]);
    expect(props.onCreate).toHaveBeenCalledWith("home");
  });

  it("offers a Create new cell in an empty Shared section, to creators only", () => {
    const props = mount({
      shared: { channelName: "releases", identities: [], markerFor: () => null, canCreate: true, peers: [] },
    });
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    fireEvent.click(within(shared).getByRole("button", { name: "Create new" }));
    expect(props.onCreate).toHaveBeenCalledWith("container");
    cleanup();
    mount({ shared: { channelName: "releases", identities: [], markerFor: () => null, canCreate: false, peers: [] } });
    const guest = screen.getByRole("region", { name: "Shared in this channel" });
    expect(within(guest).queryByRole("button", { name: "Create new" })).toBeNull();
  });

  it("puts Launch on a personal card as a small ink pill, bottom right", () => {
    mount({
      personal: {
        identities: [MINE],
        state: { kind: "ready" },
        canCreate: true,
        footer: {
          launch: { canLaunch: true, busyId: null, error: null, launch: vi.fn() },
          onAddKnowledge: vi.fn(),
        },
      },
    });
    const launch = screen.getByRole("button", { name: "Launch" });
    expect(launch.className).toContain("bg-surface-cta");
    expect(launch.className).toContain("self-end");
    expect(launch.className).not.toMatch(/w-full|auth-btn-3d|btn-light/);
  });

  it("puts live agents in Active now and finished ones only in Recent", async () => {
    mount();
    const rail = screen.getByRole("complementary", { name: "Activity" });
    expect(within(rail).getByText("Scout one")).toBeTruthy();
    expect(within(rail).queryByText("Scout two")).toBeNull();
    fireEvent.click(within(rail).getByRole("tab", { name: "Recent" }));
    await waitFor(() => expect(within(rail).getByText("Cut 1.7")).toBeTruthy());
  });

  it("draws no rail and no agent tabs when the session feed could not answer", async () => {
    mount({ sessions: null });
    expect(screen.queryByRole("complementary", { name: "Activity" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Scout/ }));
    const view = await screen.findByRole("dialog", { name: "Scout" });
    expect(within(view).queryByRole("tab")).toBeNull();
  });

  it("says No matches when a search hides every row, never the empty-shelf line", () => {
    mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Search identities" }), {
      target: { value: "zzz" },
    });
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(within(personal).getByText("No matches.")).toBeTruthy();
  });

  it("states no channel in place of the shared section, and keeps Personal", () => {
    mount({ shared: null });
    expect(screen.getByText("No channel selected")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Personal" })).toBeTruthy();
  });
});

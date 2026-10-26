// @vitest-environment jsdom
/**
 * THE TASKS TAB IN THE INFO COLUMN: offered only with a body (the `tasks` capability), left of
 * Settings, badged with the active count, kept in thread view, and switched to by the quick
 * view's ask — including the ask that opens a closed column, which mounts this panel.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ChannelsInfoPanel } from "./info-panel";
import { channelPaneTabs } from "./info-panel-tabs";
import { indexMembers } from "./view-model";
import { useChannelsSelection } from "./use-channels-selection";
import { ME, channel, member, thread } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers([member({ userId: ME, displayName: "Sam Wang" })], ME);

function panel(over: Partial<React.ComponentProps<typeof ChannelsInfoPanel>> = {}) {
  return (
    <ChannelsInfoPanel
      channel={channel()}
      channelName="Website"
      members={[member({ userId: ME })]}
      threads={[thread({ id: "t-a" })]}
      threadsTruncated={false}
      threadsLoading={false}
      index={INDEX}
      openThread={null}
      onOpenThread={vi.fn()}
      agentSessions={[]}
      openAgent={null}
      onOpenAgent={vi.fn()}
      mentions={[]}
      mentionsTruncated={false}
      mentionsLoading={false}
      onOpenMention={vi.fn()}
      onMarkAllMentionsRead={vi.fn()}
      settings={<div>settings body</div>}
      {...over}
    />
  );
}

const labels = () => screen.getAllByRole("tab").map((t) => (t.textContent ?? "").replace(/\d+$/, ""));
const selected = (label: string) =>
  screen.getByRole("tab", { name: new RegExp(`^${label}`) }).getAttribute("aria-selected") === "true";

describe("the Tasks tab", () => {
  it("sits left of Settings, and only where the host offers it", () => {
    expect(channelPaneTabs(false).map((t) => t.key)).toEqual(["info", "threads", "agents", "settings"]);
    expect(channelPaneTabs(false, true).map((t) => t.key)).toEqual([
      "info",
      "threads",
      "agents",
      "tasks",
      "settings",
    ]);
    expect(channelPaneTabs(true, true).map((t) => t.key)).toEqual(["info", "agents", "tasks", "settings"]);

    const { rerender } = render(panel());
    expect(labels()).toEqual(["Info", "Threads", "Agents", "Settings"]);
    rerender(panel({ tasks: <div>tasks body</div>, activeTaskCount: 3 }));
    expect(labels()).toEqual(["Info", "Threads", "Agents", "Tasks", "Settings"]);
    expect(screen.getByRole("tab", { name: /^Tasks/ }).textContent).toBe("Tasks3");
  });

  it("shows its body when picked", async () => {
    render(panel({ tasks: <div>tasks body</div> }));
    fireEvent.click(screen.getByRole("tab", { name: /^Tasks/ }));
    expect(selected("Tasks")).toBe(true);
    expect(await screen.findByText("tasks body")).toBeTruthy();
  });

  it("switches on each rise of the ask, and lands on Tasks when the ask mounts it", () => {
    const { rerender, unmount } = render(panel({ tasks: <div>tasks body</div> }));
    expect(selected("Info")).toBe(true);
    rerender(panel({ tasks: <div>tasks body</div>, tasksTabSignal: 1 }));
    expect(selected("Tasks")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: /^Info/ }));
    rerender(panel({ tasks: <div>tasks body</div>, tasksTabSignal: 2 }));
    expect(selected("Tasks")).toBe(true);
    // The column closes (the ask zeroes) and the panel unmounts with it.
    rerender(panel({ tasks: <div>tasks body</div>, tasksTabSignal: 0 }));
    unmount();
    render(panel({ tasks: <div>tasks body</div>, tasksTabSignal: 0 }));
    expect(selected("Info")).toBe(true);
    cleanup();
    render(panel({ tasks: <div>tasks body</div>, tasksTabSignal: 1 }));
    expect(selected("Tasks")).toBe(true);
  });
});

describe("the selection's task ask", () => {
  it("opens the column on the task over an open agent view, and closing the column zeroes the ask", () => {
    const { result } = renderHook(() => useChannelsSelection({ initialChannelId: "c-1" }));
    act(() => result.current.setOpenAgent("agent-1"));
    act(() => result.current.setInfoOpen(false));
    act(() => result.current.openTask("t-1"));
    expect(result.current).toMatchObject({
      infoOpen: true,
      openAgent: null,
      openTaskId: "t-1",
      tasksTabSignal: 1,
    });
    act(() => result.current.toggleInfo());
    expect(result.current.tasksTabSignal).toBe(0);
    act(() => result.current.selectChannel("c-2"));
    expect(result.current.openTaskId).toBeNull();
  });
});

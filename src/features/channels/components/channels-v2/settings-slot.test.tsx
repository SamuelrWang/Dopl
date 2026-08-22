// @vitest-environment jsdom
/**
 * WHICH MANAGE SURFACE THE SETTINGS TAB HOSTS (Samuel, 2026-08-21).
 *
 * ⚠ THE THING UNDER TEST IS A MOUNT BOUNDARY, NOT A TERNARY. `channel-manage.tsx`
 * opens `useTrustRules` (`/api/channels/trust`) plus two write-hook families on
 * mount, and INVARIANTS §5 pins that none of them fire until the Settings tab is
 * opened. Branching inside either host would run the other's hooks regardless —
 * hooks cannot sit behind an early return — so the wrong host must never mount at
 * all. Both hosts are stubbed here precisely so "did it mount" is the assertion.
 *
 * Also pinned: the manage gate handed to the thread host is the SAME pair the
 * server reads (`service-shared.ts › canManageChannel` — channel owner, or
 * workspace admin). A display gate that is wider than the route's is a row that
 * only ever produces a 403.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./channel-manage", () => ({
  ChannelsV2ManageActions: () => <div data-testid="channel-manage" />,
}));
vi.mock("./thread-manage", () => ({
  ChannelsV2ThreadManageActions: (props: { canManageChannel: boolean }) => (
    <div
      data-testid="thread-manage"
      data-can-manage={String(props.canManageChannel)}
    />
  ),
}));

import { ChannelsV2SettingsSlot } from "./settings-slot";
import { channel, thread as makeThread } from "./test-fixtures";
import type { Role } from "@/features/workspaces/types";
import type { Channel, ChannelThread } from "../../types";

afterEach(cleanup);

const noop = () => {};

function mount(over: {
  thread?: ChannelThread | null;
  channel?: Partial<Channel>;
  role?: Role;
}) {
  return render(
    <ChannelsV2SettingsSlot
      channel={channel(over.channel)}
      workspaceId="ws-1"
      workspaceSlug="acme"
      currentUserId="u-me"
      role={over.role ?? "member"}
      members={[]}
      thread={over.thread ?? null}
      agentSessions={null}
      gate={{ begin: noop, end: noop }}
      onDeselect={noop}
      onExitThread={noop}
      onRosterChanged={noop}
    />
  );
}

describe("the Settings tab's host", () => {
  it("is the CHANNEL cluster in channel view", () => {
    mount({ thread: null });
    expect(screen.getByTestId("channel-manage")).toBeTruthy();
    expect(screen.queryByTestId("thread-manage")).toBeNull();
  });

  /** ⚠ The channel host must not merely be hidden — it must not MOUNT, or its
   *  trust read fires every time a reader opens Settings on a thread. */
  it("is the THREAD cluster in thread view, and the channel one does not mount", () => {
    mount({ thread: makeThread() });
    expect(screen.getByTestId("thread-manage")).toBeTruthy();
    expect(screen.queryByTestId("channel-manage")).toBeNull();
  });

  it("calls a channel OWNER a manager", () => {
    mount({ thread: makeThread(), channel: { role: "owner" }, role: "member" });
    expect(
      screen.getByTestId("thread-manage").getAttribute("data-can-manage")
    ).toBe("true");
  });

  it("calls a WORKSPACE ADMIN a manager even as a plain channel member", () => {
    mount({ thread: makeThread(), channel: { role: "member" }, role: "admin" });
    expect(
      screen.getByTestId("thread-manage").getAttribute("data-can-manage")
    ).toBe("true");
  });

  it("calls a plain member neither", () => {
    mount({ thread: makeThread(), channel: { role: "member" }, role: "member" });
    expect(
      screen.getByTestId("thread-manage").getAttribute("data-can-manage")
    ).toBe("false");
  });
});

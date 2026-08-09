/**
 * Q2 — the header kebab menu must never offer a DM participant "Leave
 * channel". Leaving deletes one of the pair's two `channel_members` rows,
 * which destroys the conversation permanently (the live row keeps the pair's
 * `direct_key` reserved, so a fresh DM can't be opened either) — and the
 * non-creator, whose `role` is `member`, was the one being offered it, one
 * click, no confirmation. Both DM participants get the reversible "Delete
 * conversation" instead, which routes through the header's confirm dialog.
 *
 * Rendered statically: `Popover` returns null while closed and this repo's
 * component tests have no DOM to click the trigger with, so the items render
 * directly (`ChannelActionsMenuItems`).
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelActionsMenuItems } from "./channel-actions-menu";
import type { Channel } from "../types";

const ME = "u-me";

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "w1",
    slug: "general",
    name: "general",
    topic: "",
    visibility: "public",
    isDirect: false,
    directPeer: null,
    createdBy: ME,
    archivedAt: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    memberCount: 2,
    lastMessageAt: null,
    role: "member",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: "all",
    myAgentToolProfile: "full",
    onlineMemberCount: 0,
    ...over,
  };
}

const noop = () => {};

function markup(over: Partial<Channel>, canManage: boolean) {
  return renderToStaticMarkup(
    <ChannelActionsMenuItems
      channel={channel(over)}
      canManage={canManage}
      onClose={noop}
      onToggleVisibility={noop}
      onToggleArchive={noop}
      onRequestDelete={noop}
      onRequestLeave={noop}
    />
  );
}

const dm = { isDirect: true, visibility: "private" as const };

describe("ChannelActionsMenuItems — the DM has no Leave", () => {
  it("offers the non-owner DM peer Delete conversation, never Leave channel", () => {
    // Bob: the DM's non-creator, so `role: "member"` → canManage false. This is
    // the exact user the destructive item used to be rendered for.
    const html = markup({ ...dm, role: "member" }, false);

    expect(html).not.toContain("Leave channel");
    expect(html).toContain("Delete conversation");
  });

  it("offers the DM creator the same Delete conversation", () => {
    // Alice owns the row only because she opened the conversation; both sides
    // exit the same reversible way.
    const html = markup({ ...dm, role: "owner" }, true);

    expect(html).not.toContain("Leave channel");
    expect(html).toContain("Delete conversation");
    // A DM is private by DB CHECK — no visibility toggle either.
    expect(html).not.toContain("Make public");
    expect(html).not.toContain("Make private");
  });

  it("still offers Leave channel in a NON-direct channel", () => {
    // Control: the change is scoped to DMs.
    const html = markup({ role: "member" }, false);

    expect(html).toContain("Leave channel");
    expect(html).not.toContain("Delete conversation");
  });

  it("keeps the owner's full manage set on a non-direct channel", () => {
    const html = markup({ role: "owner", visibility: "private" }, true);

    expect(html).toContain("Make public");
    expect(html).toContain("Archive");
    expect(html).toContain("Delete channel");
    expect(html).not.toContain("Leave channel");
  });

  it("renders nothing for a non-member viewing a public channel", () => {
    expect(markup({ isMember: false, role: null }, false)).toBe("");
  });
});

describe("ChannelActionsMenuItems — selecting an item closes the menu", () => {
  it("runs onClose before the action for both DM exits", () => {
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push("close"));
    const onRequestDelete = vi.fn(() => calls.push("delete"));

    // Render, then invoke the item's own onSelect the way a click would.
    const items = ChannelActionsMenuItems({
      channel: channel({ ...dm, role: "member" }),
      canManage: false,
      onClose,
      onToggleVisibility: noop,
      onToggleArchive: noop,
      onRequestDelete,
      onRequestLeave: noop,
    });
    const item = findMenuItem(items);
    item.props.onSelect();

    expect(calls).toEqual(["close", "delete"]);
  });
});

/** Depth-first search for the single rendered MenuItem element. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMenuItem(node: any): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findMenuItem(child);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node.type === "function" && node.props?.onSelect) return node;
  return findMenuItem(node.props?.children);
}

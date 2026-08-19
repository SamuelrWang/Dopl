// @vitest-environment jsdom
/**
 * THE RIGHT PANEL'S SETTINGS TAB — the rows the pane header's kebab became
 * (Samuel, 2026-08-19).
 *
 * ⚠ THIS FILE INHERITS `components/channel-actions-menu.test.tsx`, WHICH WAS
 * DELETED WITH THE KEBAB IT DROVE. Its rules did not go with it, and they are
 * not styling:
 *
 *  - **Q2 — A DM MAY NEVER OFFER "Leave channel".** Leaving deletes one of the
 *    pair's two `channel_members` rows, which destroys the conversation
 *    permanently (the live row keeps the pair's `direct_key` reserved, so a
 *    fresh DM cannot be opened either) — and the non-creator, whose `role` is
 *    `member`, was the one being offered it, one click, no confirmation. Both DM
 *    participants get the reversible "Delete conversation" instead.
 *  - **A DM has no visibility toggle** — it is private by DB CHECK.
 *  - **A non-member viewing a public channel has nothing to manage**, and must
 *    not be shown a heading over an empty section.
 *
 * ⚠ AND ONE RULE THE KEBAB DID NOT HAVE: **NO DEAD ROWS** (INVARIANTS §5 — every
 * row on this surface functions). The desktop-only working folder is gated on
 * its own bridge, so a plain browser gets no labelled row with nothing in it.
 * jsdom has no `window.dopl`, so every case below is that browser.
 *
 * The rows report INTENT; `channel-manage.tsx` owns the confirm dialogs and the
 * writes, exactly as it did when the intent came from a menu item.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelsV2SettingsTab } from "./settings-tab";
import { channel } from "./test-fixtures";
import type { Channel } from "../../types";

afterEach(cleanup);

const dm = { isDirect: true, visibility: "private" as const };

function mount(over: Partial<Channel>, canManage: boolean, handlers = {}) {
  const props = {
    onInvite: vi.fn(),
    onToggleVisibility: vi.fn(),
    onToggleArchive: vi.fn(),
    onRequestDelete: vi.fn(),
    onRequestLeave: vi.fn(),
    ...handlers,
  };
  render(
    <ChannelsV2SettingsTab
      channel={channel(over)}
      canManage={canManage}
      settings={<button type="button">Channel settings</button>}
      {...props}
    />
  );
  return props;
}

const row = (name: string) => screen.queryByRole("button", { name });

describe("the DM has no Leave", () => {
  it("offers the non-owner DM peer Delete conversation, never Leave channel", () => {
    // The DM's non-creator, so `role: "member"` → canManage false. This is the
    // exact user the destructive item used to be rendered for.
    mount({ ...dm, role: "member" }, false);
    expect(row("Leave channel")).toBeNull();
    expect(row("Delete conversation")).not.toBeNull();
  });

  it("offers the DM creator the same Delete conversation", () => {
    mount({ ...dm, role: "owner" }, true);
    expect(row("Leave channel")).toBeNull();
    expect(row("Delete conversation")).not.toBeNull();
    // A DM is private by DB CHECK — no visibility toggle either.
    expect(row("Make public")).toBeNull();
    expect(row("Make private")).toBeNull();
    // And a fixed 1:1 pair has no invite (the server also rejects one).
    expect(row("Add members")).toBeNull();
  });

  it("still offers Leave channel in a NON-direct channel", () => {
    mount({ role: "member" }, false);
    expect(row("Leave channel")).not.toBeNull();
    expect(row("Delete conversation")).toBeNull();
  });
});

describe("the owner's manage set", () => {
  it("keeps all four items on a non-direct channel", () => {
    mount({ role: "owner", visibility: "private" }, true);
    expect(row("Add members")).not.toBeNull();
    expect(row("Make public")).not.toBeNull();
    expect(row("Archive")).not.toBeNull();
    expect(row("Delete channel")).not.toBeNull();
    expect(row("Leave channel")).toBeNull();
  });

  it("flips the visibility label to match the current state", () => {
    mount({ role: "owner", visibility: "public" }, true);
    expect(row("Make private")).not.toBeNull();
    expect(row("Make public")).toBeNull();
  });

  it("offers Unarchive on an archived channel", () => {
    mount({ role: "owner", archivedAt: "2026-08-01T00:00:00.000Z" }, true);
    expect(row("Unarchive")).not.toBeNull();
    expect(row("Archive")).toBeNull();
  });

  it("hides the manage half from a plain member", () => {
    mount({ role: "member" }, false);
    expect(row("Make public")).toBeNull();
    expect(row("Archive")).toBeNull();
    expect(row("Delete channel")).toBeNull();
  });
});

describe("the rows report intent — they never write", () => {
  it("hands the destructive pair to the confirm dialogs", () => {
    const props = mount({ role: "owner" }, true);
    fireEvent.click(row("Delete channel")!);
    expect(props.onRequestDelete).toHaveBeenCalledTimes(1);

    cleanup();
    const member = mount({ role: "member" }, false);
    fireEvent.click(row("Leave channel")!);
    expect(member.onRequestLeave).toHaveBeenCalledTimes(1);
  });

  it("opens the invite dialog from its own row", () => {
    const props = mount({ role: "owner" }, true);
    fireEvent.click(row("Add members")!);
    expect(props.onInvite).toHaveBeenCalledTimes(1);
  });
});

describe("no dead rows", () => {
  it("renders NO agent-folder row without the desktop bridge", () => {
    // The control renders nothing in a browser; a labelled row around it would
    // be a section header over an empty right-hand side.
    mount({ role: "owner" }, true);
    expect(screen.queryByText("Agent folder")).toBeNull();
  });

  it("says so, rather than heading an empty tab, for a non-member", () => {
    render(
      <ChannelsV2SettingsTab
        channel={channel({ isMember: false, role: null })}
        canManage={false}
        settings={null}
        onInvite={vi.fn()}
        onToggleVisibility={vi.fn()}
        onToggleArchive={vi.fn()}
        onRequestDelete={vi.fn()}
        onRequestLeave={vi.fn()}
      />
    );
    expect(screen.getByText("Nothing to manage")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

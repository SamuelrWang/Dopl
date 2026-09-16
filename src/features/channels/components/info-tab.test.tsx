// @vitest-environment jsdom
/**
 * THE CHANNEL INFO TAB's DESCRIPTION ROW (ruling, Samuel, 2026-09-15).
 *
 * ⚠ **THE ROW IS `channels.topic` WEARING THE PRODUCT'S WORD** — pinned here so
 * a later wave cannot "fix" the label/field mismatch by adding a second field.
 *
 * ⚠ THE EMPTY CASE IS THE ONE THAT ROTS QUIETLY: the column is `NOT NULL DEFAULT
 * ''`, so an absent description is the COMMON row and a blank cell would read as
 * a render bug. "None", muted, no explainer sentence (minimal-copy ruling).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InfoTab } from "./info-tab";
import { channel, member, ME } from "./test-fixtures";

afterEach(cleanup);

const MEMBERS = [member({ userId: ME, displayName: "Sam Wang" })];

function mount(topic: string) {
  render(
    <InfoTab
      channel={channel({ topic })}
      channelName="Website"
      members={MEMBERS}
      threadCount={0}
      mentions={[]}
      mentionsTruncated={false}
      mentionsLoading={false}
      index={{ currentUserId: ME, byId: new Map(), agents: new Map() }}
      onOpenMention={vi.fn()}
      onMarkAllMentionsRead={vi.fn()}
    />
  );
}

describe("the Description row", () => {
  it("shows the channel's own topic under the product's word", () => {
    mount("The redesign");
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("The redesign")).toBeTruthy();
  });

  it("says None — not an empty cell — when the channel has no description", () => {
    mount("");
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("sits between Name and Creator, where the subject's own facts are", () => {
    // ⚠ POSITION IS THE ASSERTION: the card reads subject → what it is about →
    // who made it. The same ladder is composed a second time on /home
    // (`apps/desktop-ui › person-info-tab.tsx`), and the two are meant to match.
    mount("The redesign");
    const name = screen.getByText("Name");
    const description = screen.getByText("Description");
    const creator = screen.getByText("Creator");
    expect(
      name.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(creator) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

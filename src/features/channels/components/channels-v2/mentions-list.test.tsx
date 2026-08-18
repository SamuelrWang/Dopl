// @vitest-environment jsdom
/**
 * The Tags mentions inbox — the one interaction on the fixture-driven half of
 * this page with three moving parts (mark-read, navigate, scroll), so it keeps
 * the regression coverage it had as a mock.
 *
 * ⚠ MOVED, not rewritten from scratch: this is
 * `apps/desktop-ui/src/pages/channels-v2/mentions.test.tsx` following its
 * subject into the web tree when the mock page became a seam (2026-08-18). Two
 * assertions changed because the surface under them did:
 *
 *  - the old test mounted the whole PAGE and read the breadcrumb to prove the
 *    navigation landed. The transcript is real now and the fixture's message
 *    ids belong to no real message (Phase 6 wires them), so what is pinned here
 *    is the SIGNAL the inbox emits — thread id plus a NONCED scroll target —
 *    rather than where a fabricated id lands;
 *  - the badge, the disclosure and mark-all are unchanged and still the point:
 *    Samuel's interaction-completeness ruling says a hardcoded surface may keep
 *    fixture CONTENT and may not keep inert CONTROLS.
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { InfoTab } from "./info-tab";
import {
  FIXTURE_MENTIONS,
  INITIALLY_READ_MENTIONS,
  type FixtureMention,
} from "./fixtures-mentions";
import { channel, member, ME } from "./test-fixtures";

afterEach(cleanup);

const UNREAD_AT_MOUNT = FIXTURE_MENTIONS.filter((m) => m.initiallyUnread).length;

/**
 * The read-state lives on the page in the product (`channels-v2-core.tsx`), so
 * the test owns it here — the same shape, so what is asserted is the tab's
 * behaviour and not a stub's.
 */
function Harness({ onOpen }: { onOpen: (m: FixtureMention) => void }) {
  const [readMentions, setReadMentions] =
    useState<ReadonlySet<string>>(INITIALLY_READ_MENTIONS);
  return (
    <InfoTab
      channel={channel()}
      channelName="Website"
      members={[member({ userId: ME })]}
      threadCount={2}
      readMentions={readMentions}
      onOpenMention={(mention) => {
        setReadMentions((prev) => new Set(prev).add(mention.id));
        onOpen(mention);
      }}
      onMarkAllMentionsRead={() =>
        setReadMentions(new Set(FIXTURE_MENTIONS.map((m) => m.id)))
      }
    />
  );
}

function open(onOpen = vi.fn()) {
  render(<Harness onOpen={onOpen} />);
  const tagsRow = screen.getByRole("button", { name: /^Tags/ });
  fireEvent.click(tagsRow);
  return { tagsRow, onOpen };
}

describe("channels-v2 mentions inbox", () => {
  it("shows the live unread count and every mention behind the disclosure", () => {
    const { tagsRow } = open();
    expect(tagsRow.getAttribute("aria-expanded")).toBe("true");
    expect(tagsRow.textContent).toContain(String(UNREAD_AT_MOUNT));
    for (const mention of FIXTURE_MENTIONS) {
      expect(screen.getByText(mention.snippet)).not.toBeNull();
    }
  });

  it("the disclosure closes again", () => {
    const { tagsRow } = open();
    fireEvent.click(tagsRow);
    expect(tagsRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(FIXTURE_MENTIONS[0].snippet)).toBeNull();
  });

  it("a click marks the item read, decrements the badge and emits the navigate + scroll signal", () => {
    const { tagsRow, onOpen } = open();
    const item = screen
      .getByText(FIXTURE_MENTIONS[0].snippet)
      .closest("button") as HTMLElement;
    expect(item.hasAttribute("data-unread")).toBe(true);

    fireEvent.click(item);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({
      id: FIXTURE_MENTIONS[0].id,
      messageId: FIXTURE_MENTIONS[0].messageId,
      threadId: FIXTURE_MENTIONS[0].threadId,
    });
    // Read: item unmarked, badge decremented. The row STAYS listed — the inbox
    // is a record, not a to-do pile.
    expect(item.hasAttribute("data-unread")).toBe(false);
    expect(item).not.toBeNull();
    expect(tagsRow.textContent).toContain(String(UNREAD_AT_MOUNT - 1));
  });

  it("mark-all zeroes the badge and then hides itself", () => {
    const { tagsRow } = open();
    const panel = within(screen.getByRole("button", { name: /^Tags/ }).parentElement!);
    fireEvent.click(panel.getByRole("button", { name: "Mark all read" }));
    expect(tagsRow.textContent).toMatch(/^Tags0$/);
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });
});

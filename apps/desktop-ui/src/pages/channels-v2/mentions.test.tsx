/**
 * The Tags mentions inbox — the one interaction on this mock with three moving
 * parts (mark-read, navigate, scroll), so it earns regression coverage where
 * the page's other inert controls do not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ChannelsV2Page from "./index";
import { MENTIONS } from "./mock-mentions";

// jsdom has no scrollIntoView; the effect must still find the row and call it.
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

function openTagsDisclosure() {
  render(<ChannelsV2Page />);
  const tagsRow = screen.getByRole("button", { name: /^Tags/ });
  fireEvent.click(tagsRow);
  return tagsRow;
}

describe("channels-v2 mentions inbox", () => {
  it("shows the live unread count and every mention", () => {
    const tagsRow = openTagsDisclosure();
    const unread = MENTIONS.filter((m) => m.initiallyUnread).length;
    expect(tagsRow).toHaveTextContent(String(unread));
    for (const mention of MENTIONS) {
      expect(screen.getByText(mention.snippet)).toBeInTheDocument();
    }
  });

  it("click navigates to the mention's thread, scrolls to the row and marks it read", () => {
    const tagsRow = openTagsDisclosure();
    const before = MENTIONS.filter((m) => m.initiallyUnread).length;

    // The qa-sweep mention lives in a thread — clicking it must swap the
    // center pane BEFORE the scroll effect looks the message row up.
    const item = screen
      .getByText(MENTIONS[0].snippet)
      .closest("button") as HTMLElement;
    expect(item).toHaveAttribute("data-unread");
    fireEvent.click(item);

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).toHaveTextContent("Design QA sweep");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Read: item unmarked, badge decremented.
    expect(item).not.toHaveAttribute("data-unread");
    expect(tagsRow).toHaveTextContent(String(before - 1));
  });

  it("a channel mention returns to the channel view, and mark-all zeroes the badge", () => {
    const tagsRow = openTagsDisclosure();

    // Walk into a thread first so the channel mention has a view to restore.
    fireEvent.click(screen.getByText(MENTIONS[0].snippet).closest("button") as HTMLElement);
    fireEvent.click(screen.getByText(MENTIONS[1].snippet).closest("button") as HTMLElement);

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs).not.toHaveTextContent("Design QA sweep");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    const disclosure = within(screen.getByRole("complementary", { name: "Channel info" }));
    fireEvent.click(disclosure.getByRole("button", { name: "Mark all read" }));
    expect(tagsRow).toHaveTextContent(/^Tags0$/);
  });
});

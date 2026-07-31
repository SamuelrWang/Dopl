/**
 * The invite dialog is the only surface where a person CHANGES how a channel
 * routes, and it used to say nothing about it. Adding one member to a pair
 * retires the implicit recipient: from that moment every unaddressed ask
 * reaches no agent at all (`dopl-desktop-app/main/targeting.js` fires its
 * implicit trigger only on a known-exact `memberCount === 2`). The note states
 * that, plus the thread rule a group channel exposes and a DM never does
 * (channel-visible reads, pair-only writes).
 *
 * Rendered statically: the dialog itself needs a TanStack provider, so the note
 * is a pure exported component and these cases drive it directly — the same
 * split `ChannelActionsMenuItems` uses.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupChannelRoutingNote } from "./invite-dialog";
import { GROUP_CHANNEL_MIN_MEMBERS } from "../constants";

const markup = (memberCount: number) =>
  renderToStaticMarkup(<GroupChannelRoutingNote memberCount={memberCount} />);

describe("GroupChannelRoutingNote — the group rules, stated before they apply", () => {
  it("appears one member BEFORE the threshold, so the adder reads it in time", () => {
    // A pair: the very next add is what retires the implicit recipient.
    const html = markup(GROUP_CHANNEL_MIN_MEMBERS - 1);

    expect(html).toContain("only if you address it to someone");
    expect(html).toContain("Unaddressed messages reach nobody.");
  });

  it("states the thread rule a DM never exposes", () => {
    const html = markup(GROUP_CHANNEL_MIN_MEMBERS);

    // Reads are channel-transparent (`listChannelTasks` is unfiltered); writes
    // are pair-only (403 TASK_FORBIDDEN in `service-writes-metadata.ts`).
    expect(html).toContain("everyone in the channel can read one");
    expect(html).toContain("only its two participants can post into it");
  });

  it("keeps saying it in an already-large channel", () => {
    expect(markup(GROUP_CHANNEL_MIN_MEMBERS + 5)).toContain(
      "Unaddressed messages reach nobody."
    );
  });

  it("renders nothing while the roster is still loading", () => {
    // The dialog passes `channelMembers?.length ?? 0`. Silence beats a note
    // that flashes on every open.
    expect(markup(0)).toBe("");
  });

  it("renders nothing for a channel that cannot reach the threshold by one add", () => {
    expect(markup(GROUP_CHANNEL_MIN_MEMBERS - 2)).toBe("");
  });

  it("never promises a count the desktop rule does not use", () => {
    // The copy restates GROUP_CHANNEL_MIN_MEMBERS and nothing else, so the one
    // number in the sentence moves with the constant instead of drifting.
    expect(markup(GROUP_CHANNEL_MIN_MEMBERS)).toContain(
      `In a channel of ${GROUP_CHANNEL_MIN_MEMBERS} or more`
    );
  });
});

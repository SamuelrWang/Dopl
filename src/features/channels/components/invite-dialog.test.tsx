/**
 * The invite dialog is the only surface where a person CHANGES how a channel
 * routes, and it used to say nothing about it. The note states the addressing
 * rule and the thread rule a DM never exposes (channel-visible reads, pair-only
 * writes).
 *
 * ⚠ **WHAT THIS FILE NOW PINS IS THE ABSENCE OF A COUNT.** Phase 3 (2026-08-18)
 * made addressing explicit at every member count — `targeting.js › classify` no
 * longer reads `memberCount` and the DM auto-address is retired — but the note
 * kept teaching the retired rule twice over: copy reading "In a channel of 3 or
 * more…" behind a `memberCount < GROUP_CHANNEL_MIN_MEMBERS - 1` gate, so a
 * two-person channel (the one whose interface most implies an implicit
 * recipient) was told nothing at all. Both are gone; the note takes no props
 * and always renders.
 *
 * Rendered statically: the dialog itself needs a TanStack provider, so the note
 * is a pure exported component and these cases drive it directly — the same
 * split `ChannelActionsMenuItems` uses.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupChannelRoutingNote } from "./invite-dialog";

const markup = () => renderToStaticMarkup(<GroupChannelRoutingNote />);

describe("GroupChannelRoutingNote — one rule, at every size", () => {
  it("states that addressing is required, and that it is required at EVERY size", () => {
    const html = markup();

    expect(html).toContain("only when you address it to someone");
    expect(html).toContain("unaddressed messages reach nobody");
    // The two-person case said out loud: it is the one a reader gets wrong.
    expect(html).toContain("a two-person channel included");
  });

  it("states the thread rule a DM never exposes", () => {
    const html = markup();

    // Reads are channel-transparent (`listChannelTasks` is unfiltered); writes
    // are pair-only (403 TASK_FORBIDDEN in `service-writes-metadata.ts`).
    expect(html).toContain("everyone in the channel can read one");
    expect(html).toContain("only its two participants can post into it");
  });

  it("NEVER states a member-count threshold — the rule no longer has one", () => {
    // The regression this guards: reintroducing "In a channel of N or more",
    // which teaches the trigger rule that was retired in Phase 3. A digit
    // anywhere in the copy is the smell, so the whole rendered text is checked.
    const text = markup().replace(/<[^>]*>/g, "");
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain("or more");
  });

  it("renders unconditionally — there is no props shape to gate it on", () => {
    // A count-gated note is what hid the rule from a 2-member channel, and a
    // roster-length gate additionally made it appear a beat after the dialog
    // opened. `GroupChannelRoutingNote` takes no arguments at all now.
    expect(GroupChannelRoutingNote.length).toBe(0);
    expect(markup()).not.toBe("");
  });
});

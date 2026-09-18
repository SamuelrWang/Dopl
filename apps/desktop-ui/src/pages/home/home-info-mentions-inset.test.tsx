import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge } from "#/test-utils/bridge";
import { openChannelRecord, renderHome, routes } from "./home-test-harness";

/**
 * 🔒 **THE MENTION ROWS START WHERE EVERY OTHER SECTION ON THIS TAB STARTS
 * (Samuel, 2026-09-17, verbatim):** *"For mentions, each individual mention is
 * starting further right, so it is not saying flush with the rest of the things.
 * It should be moved a little bit to the left to start at the same place."*
 *
 * ⚠ **A FILE OF ITS OWN BECAUSE THE INBOX HAS TO HAVE ROWS IN IT**, and
 * `home-info-mentions.test.tsx` is the EMPTY inbox — its three cases assert
 * the section's presence, its openness and its position, and every one of them
 * reads the empty sentence. The stub's mention bundle is a module-level `vi.mock`,
 * so "with rows" and "with none" cannot be two cases in one file.
 *
 * ⚠ **PINNED ON THE CLASS RECIPE, WHICH IS THE ONLY HONEST FORM HERE** — jsdom
 * lays nothing out, so "it is flush" would be a sentence about a renderer that
 * never ran. What CAN be stated is the arithmetic: the tab's column edge is
 * `px-3.5`, a mention row carries its own `px-2`, and the list therefore hangs at
 * 14 − 8 = 6px. The list's OTHER host keeps the 28px hang, pinned in
 * `channels/components/mentions-list.test.tsx`.
 */

const apiRequest = vi.hoisted(() => vi.fn());

// ⚠ THE SHARED STUB WITH ONE MENTION IN THE BUNDLE — the surface owns that read
// (`ChannelInfoTabContext.mentions`), so this is where a row comes from. The
// factory imports everything itself: `vi.mock` is hoisted above every import.
vi.mock("@/features/channels/components/channel-surface-standalone", async () => {
  const { standaloneSurfaceStub, EMPTY_MENTIONS } = await import(
    "./surface-slot-fixtures"
  );
  const { mention } = await import(
    "@/features/channels/components/test-fixtures"
  );
  return standaloneSurfaceStub({
    mentions: {
      ...EMPTY_MENTIONS,
      mentions: [mention({ snippet: "can you look before the freeze?" })],
    },
  });
});

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
  apiRequest.mockImplementation((path: string, opts = {}) => routes(path, opts));
});

describe("home info tab — where the Mentions list starts", () => {
  it("hangs the rows on the tab's column edge, not under a disclosure's label", async () => {
    renderHome();
    await openChannelRecord();

    const row = (await screen.findByText("can you look before the freeze?"))
      .closest("button")!;
    const list = row.parentElement!;
    // 🔒 *"It should be moved a little bit to the left to start at the same
    // place."* — the list used to carry `pl-7`, which hangs its rows under
    // `mentions-disclosure.tsx`'s ROW LABEL. There is no disclosure here.
    expect(list.className).not.toContain("pl-7");
    expect(list.className).toContain("pl-1.5");
    // ⚠ THE OTHER HALF OF THE ARITHMETIC, ASSERTED SO THE PAIR CANNOT DRIFT: the
    // row's own hover inset is what the 6px is measured against.
    expect(row.className).toContain("px-2");
  });

  it("lands on the SAME edge as the headings and the sections around it", async () => {
    renderHome();
    await openChannelRecord();
    await screen.findByText("can you look before the freeze?");

    // ⚠ `bits.tsx › PanelHeading` — the edge every section on this tab is
    // measured from, and the thing Samuel was comparing the rows against.
    for (const title of ["Channel info", "Channel activity", "Mentions"]) {
      expect(screen.getByText(title).parentElement!.className).toContain("px-3.5");
    }
  });
});

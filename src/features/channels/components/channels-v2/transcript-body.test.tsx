// @vitest-environment jsdom
/**
 * HOW A BODY SITS IN ITS BLOCK (Samuel, 2026-08-19, live review of the
 * transcript). Split out of `transcript.test.tsx`, which has no headroom under
 * the 500-line cap — the sides/receipts/fan-out properties stay there.
 *
 * Two properties, and they are INDEPENDENT, which is the whole ruling:
 *
 *  1. **AN UNBROKEN RUN WRAPS.** A body with no spaces in it escaped the pane
 *     horizontally and clipped at its edge. `wrap-anywhere` is the fix, and
 *     these assertions name that class rather than "some wrap class" on
 *     purpose: `break-words` would satisfy a vaguer check and would NOT fix
 *     this. `overflow-wrap: break-word` leaves an element's MIN-CONTENT width
 *     alone, and an own-message column is `items-end` — i.e. fit-content, sized
 *     from min-content — so the block would still be as wide as the unbroken
 *     run and merely wrap inside it. Only `anywhere` shrinks min-content.
 *  2. **OWN MESSAGES KEEP THE SIDE AND LOSE THE TEXT ALIGNMENT.** The block
 *     still hangs right (`flex-row-reverse` + `items-end`) — that is the
 *     `author_user_id` rule in INVARIANTS §5 and nothing here touches it. What
 *     went is `text-right` on the body, so wrapped prose reads left like every
 *     other paragraph in the app.
 *  3. **THE BODY IS CAPPED BELOW THE COLUMN** (added the same day, after the
 *     wrapped own messages still read full-width left). `items-end` sizes a
 *     child to `fit-content(available)`, which for a body whose max-content
 *     exceeds the column IS the full column — so the anchoring had nothing to
 *     pull against. `max-w-[92%]` is what leaves the gap (92 since Samuel widened the text 2026-08-19), and it is a
 *     PERCENTAGE so a narrow column (the pop-out thread window) cannot outgrow
 *     it. Both sides carry it; peer rows hug left either way.
 *
 * ⚠ CLASS PINS BY NECESSITY: jsdom computes no layout, so there is no width to
 * measure. They are mutation guards on the three exact classes the review was
 * about, and #1's and #3's notes above are why the class names are load-bearing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows, threadRows, type TranscriptRow } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { member, message, thread, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

/** The one string this file is about: no spaces, wider than any pane. */
const UNBROKEN = "segwegwtestets".repeat(14);

function renderRows(rows: TranscriptRow[]) {
  render(
    <Transcript
      rows={rows}
      index={INDEX}
      flashId={null}
      requested={new Set()}
      onDecideThread={vi.fn()}
      onOpenThread={vi.fn()}
    />
  );
}

/** The `<article data-message-id>` a body string landed in. */
function rowFor(text: string): HTMLElement {
  return screen.getByText(text, { exact: false }).closest("article") as HTMLElement;
}

/** The `<p>` a body string landed in — `Body` splits it into spans. */
function bodyFor(text: string): HTMLElement {
  return screen.getByText(text, { exact: false }).closest("p") as HTMLElement;
}

function renderBothSides() {
  renderRows(
    channelRows(
      [
        message({ id: "mine", body: UNBROKEN, authorUserId: ME }),
        message({ id: "theirs", seq: 2, body: "THEIR-TEXT", authorUserId: PEER }),
      ],
      [],
      INDEX,
      formatChannelTimestamp
    )
  );
}

describe("channels-v2 transcript — an unbroken body wraps", () => {
  it("wraps rather than escaping the pane, on both sides", () => {
    renderBothSides();
    expect(bodyFor(UNBROKEN).className).toContain("wrap-anywhere");
    expect(bodyFor("THEIR-TEXT").className).toContain("wrap-anywhere");
  });

  it("wraps in the THREAD view too — the derivation differs, the row does not", () => {
    // The pop-out window (`message-pane.tsx` with `chrome="window"`) renders
    // exactly these rows from exactly this derivation, so it is covered here.
    renderRows(
      threadRows(
        [
          message({
            id: "t",
            body: UNBROKEN,
            authorUserId: PEER,
            metadata: { taskId: "t-1" },
          }),
        ],
        "t-1",
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(bodyFor(UNBROKEN).className).toContain("wrap-anywhere");
  });

  it("wraps a thread card's title and its preview", () => {
    // The card's `.bento` is `max-w-[460px]`; without this the title runs past
    // its edge and the clamped preview is merely hidden, not contained.
    renderRows(
      channelRows(
        [message({ id: "open", body: UNBROKEN, metadata: { taskId: "t-1" } })],
        [thread({ id: "t-1", title: UNBROKEN })],
        INDEX,
        formatChannelTimestamp
      )
    );
    const drawn = screen.getAllByText(UNBROKEN);
    expect(drawn.length).toBeGreaterThan(1); // the title AND the preview
    for (const el of drawn) expect(el.className).toContain("wrap-anywhere");
  });

  it("wraps a roster name with no spaces in it", () => {
    renderRows(
      channelRows(
        [message({ id: "n", body: "HI", authorUserId: PEER })],
        [],
        indexMembers(
          [
            member({ userId: ME, displayName: "Sam Wang" }),
            member({ userId: PEER, displayName: UNBROKEN, role: "member" }),
          ],
          ME
        ),
        formatChannelTimestamp
      )
    );
    expect(screen.getByText(UNBROKEN).className).toContain("wrap-anywhere");
  });
});

describe("channels-v2 transcript — my own message: anchored right, text left", () => {
  it("carries no `text-right` anywhere in an own row", () => {
    renderBothSides();
    expect(bodyFor(UNBROKEN).className).not.toContain("text-right");
    expect(rowFor(UNBROKEN).innerHTML).not.toContain("text-right");
  });

  it("STILL hangs the block on my side — the side is not what changed", () => {
    renderBothSides();
    expect(rowFor(UNBROKEN).className).toContain("flex-row-reverse");
    expect(rowFor("THEIR-TEXT").className).not.toContain("flex-row-reverse");
    // `items-end` on the body's own column is what anchors it.
    expect(bodyFor(UNBROKEN).parentElement?.className).toContain("items-end");
    expect(bodyFor("THEIR-TEXT").parentElement?.className).not.toContain(
      "items-end"
    );
  });

  it("CAPS the body below the column, or `items-end` anchors nothing", () => {
    // Without this a wrapped own message is fit-content = the WHOLE column, and
    // its left-aligned lines start at the column's left edge: the row reads
    // full-width and left-anchored, which is the bug this pins shut.
    renderBothSides();
    expect(bodyFor(UNBROKEN).className).toContain("max-w-[92%]");
  });

  it("caps the PEER side to the same measure — symmetric, still hugging left", () => {
    renderBothSides();
    expect(bodyFor("THEIR-TEXT").className).toContain("max-w-[92%]");
    expect(bodyFor("THEIR-TEXT").parentElement?.className).not.toContain(
      "items-end"
    );
  });

  it("anchors a CONTINUATION the same way, spacer and all", () => {
    // A continuation drops the avatar and the name line, not the geometry: it
    // shares `AuthoredRow`'s column, so it must inherit the same `items-end` +
    // cap, and it must keep the `w-10` gutter or it would line up left of the
    // header row it continues.
    renderRows(
      channelRows(
        [
          message({ id: "a", body: "FIRST-LINE", authorUserId: ME }),
          message({ id: "b", seq: 2, body: UNBROKEN, authorUserId: ME }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    const run = rowFor(UNBROKEN);
    expect(run).not.toBe(rowFor("FIRST-LINE")); // two rows, one run
    expect(rowFor("FIRST-LINE").textContent).toContain("You");
    expect(run.textContent).not.toContain("You"); // no name line = continuation
    expect(run.className).toContain("flex-row-reverse");
    expect(run.firstElementChild?.className).toContain("w-10");
    expect(bodyFor(UNBROKEN).parentElement?.className).toContain("items-end");
    expect(bodyFor(UNBROKEN).className).toContain("max-w-[92%]");
  });
});

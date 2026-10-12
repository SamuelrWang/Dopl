// @vitest-environment jsdom
/**
 * **A CITATION THE BODY NEVER MENTIONS IS STILL REACHABLE** (grammar B,
 * 2026-10-12).
 *
 * ⚠ **THE HOLE GRAMMAR B OPENS.** Under the old rule a reference existed only if
 * the author typed the number, so nothing could be cited invisibly. Now the FIELD
 * is the reference, and an agent can cite three messages while writing "as
 * discussed above" — leaving the reader told nothing and able to reach nothing,
 * while the author believes the reference landed. These cases are that failure.
 *
 * ⚠ Driven through a real `Transcript`, like its siblings, because the chip row
 * can fail by not being RENDERED by the row at all — the "complete and inert"
 * mode this feature has already hit once.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { member, message, ME, PEER } from "./test-fixtures";
import type { ResolvedCite } from "../lib/cites";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

function cite(over: Partial<ResolvedCite> = {}): ResolvedCite {
  return { messageId: "m-cited", seq: 1759, no: null, thread: null, ...over };
}

function renderBody(
  body: string,
  cites: ResolvedCite[] | null | undefined,
  opts: { withJump?: boolean } = {}
) {
  const onJumpToSeq = vi.fn();
  render(
    <Transcript
      rows={channelRows(
        [message({ id: "m-row", seq: 3, body, authorUserId: PEER, cites })],
        [],
        INDEX,
        formatChannelTimestamp
      )}
      index={INDEX}
      flashId={null}
      onOpenThread={vi.fn()}
      newestSeq={2000}
      onJumpToSeq={opts.withJump === false ? undefined : onJumpToSeq}
    />
  );
  return { onJumpToSeq };
}

/** Everything pressable that navigates — pills in the body AND chips below it. */
function jumpControls(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: /Go to message/ });
}

function chipRow(): HTMLElement | null {
  const label = screen.queryByText("Cites");
  return label === null ? null : (label.parentElement as HTMLElement);
}

/** The CHIPS specifically — `data-cite-chip`, not the accessible name, which the
 *  in-body pill shares on purpose. */
function chips(): HTMLElement[] {
  return jumpControls().filter((el) => el.hasAttribute("data-cite-chip"));
}

describe("a cited message the sentence never names", () => {
  it("🔒 gets a chip, and it navigates", () => {
    const { onJumpToSeq } = renderBody("as discussed above", [cite()]);
    const row = chipRow();
    expect(row, "a cited message with no affordance is unreachable").not.toBeNull();
    const chip = screen.getByRole("button", { name: "Go to message #1759" });
    fireEvent.click(chip);
    expect(onJumpToSeq).toHaveBeenCalledWith(1759);
  });

  it("is labelled by its per-channel number once there is one", () => {
    // ⚠ The FACE is `no`, the JUMP is `seq` — the same split the pill makes.
    const { onJumpToSeq } = renderBody("as discussed", [cite({ seq: 4228, no: 12 })]);
    const chip = screen.getByRole("button", { name: "Go to message #12" });
    expect(chip.textContent).toBe("#12");
    fireEvent.click(chip);
    expect(onJumpToSeq).toHaveBeenCalledWith(4228);
  });

  it("chips every unmentioned citation", () => {
    renderBody("see above", [cite({ seq: 1759 }), cite({ messageId: "m-2", seq: 4228 })]);
    expect(jumpControls().map((c) => c.textContent)).toEqual(["#1759", "#4228"]);
  });
});

describe("it draws only what the body left out", () => {
  it("🔒 NO chip row when every citation is named inline", () => {
    // The common case. Repeating them would double every reference and train the
    // reader to ignore the row.
    renderBody("re #1759 — fixed", [cite()]);
    expect(chipRow()).toBeNull();
    expect(jumpControls()).toHaveLength(1);
  });

  it("🔒 chips the unmentioned ONE while the mentioned one stays a pill", () => {
    renderBody("re #1759 — and another thing", [
      cite({ seq: 1759 }),
      cite({ messageId: "m-2", seq: 4228 }),
    ]);
    expect(chipRow()).not.toBeNull();
    // One pill in the sentence, one chip below it — and not two of either.
    expect(jumpControls().map((c) => c.textContent)).toEqual(["#1759", "#4228"]);
  });

  it("🔒 counts a mention by the SAME RULE the pill uses", () => {
    // `no` matched inline must count as mentioned, or the reader gets a pill and
    // a chip for one message. One rule, asked twice.
    renderBody("see #12 above", [cite({ seq: 4228, no: 12 })]);
    expect(chipRow()).toBeNull();
  });
});

describe("the states that draw nothing", () => {
  it("a LEGACY row has no chips — it has no resolved citations at all", () => {
    renderBody("re #1759 — fixed", undefined);
    expect(chipRow()).toBeNull();
  });

  it("a stamped row that cited nothing has no chips", () => {
    renderBody("my #1 priority", []);
    expect(chipRow()).toBeNull();
  });

  it("🔒 no chips when the host cannot jump", () => {
    // Absent-not-disabled: a chip that cannot navigate must not look like it can.
    renderBody("as discussed above", [cite()], { withJump: false });
    expect(chipRow()).toBeNull();
  });
});

describe("code is not prose, and the tie breaks toward reachable", () => {
  it("🔒 a number only inside a FENCE still gets a chip, and ONE control total", () => {
    // ⚠ **MEASURED, NOT ASSUMED** (2026-10-12): the body renderer draws no pills
    // inside fences or inline spans, so a number appearing only in a sample is
    // not an affordance and counting it as one would leave the citation with no
    // way in. Asserting ONE control is what keeps that true from both ends — if
    // the renderer ever starts pilling code, this goes red as a DUPLICATE rather
    // than passing while the reader sees the same reference twice.
    renderBody("see the sample:\n\n```\nGET /messages/#1759\n```\n", [cite()]);
    expect(chipRow()).not.toBeNull();
    expect(jumpControls().map((c) => c.textContent)).toEqual(["#1759"]);
    expect(chips()).toHaveLength(1);
  });

  it("🔒 and one only inside an INLINE span does too", () => {
    renderBody("the id is `#1759` in the payload", [cite()]);
    expect(chipRow()).not.toBeNull();
    expect(jumpControls().map((c) => c.textContent)).toEqual(["#1759"]);
  });

  it("a number in prose AND in code counts as mentioned", () => {
    renderBody("re #1759, see `#1759`", [cite()]);
    expect(chipRow()).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * THE CITATION PILL, RENDERED (2026-09-15). The PATTERN is pinned in
 * `lib/message-refs.test.ts`; this owns what the transcript DRAWS and, mostly,
 * what it refuses to draw.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageMarkdown } from "./message-markdown";
import { indexMembers } from "./view-model";
import { member, ME } from "./test-fixtures";

const index = indexMembers([member({ userId: ME })], ME);

// ⚠ THIS SUITE RENDERS REPEATEDLY AND ASSERTS ON ABSENCE, so a leftover tree from
// the previous case reads as a pill this one drew.
afterEach(cleanup);

function body(text: string, over: { newestSeq?: number | null; onJump?: (s: number) => void } = {}) {
  render(
    <MessageMarkdown
      text={text}
      index={index}
      mentionsMe={false}
      newestSeq={over.newestSeq === undefined ? 2000 : over.newestSeq}
      onJumpToSeq={over.onJump}
    />
  );
}

describe("a cited message becomes a pill", () => {
  it("renders a citation as a button that says where it goes", () => {
    body("re #1759 — see my note", { onJump: vi.fn() });
    const pill = screen.getByRole("button", { name: "Go to message 1759" });
    expect(pill.textContent).toBe("#1759");
  });

  it("hands the SEQ to the host on click", () => {
    const onJump = vi.fn();
    body("see seq 1800 for the fix", { onJump });
    fireEvent.click(screen.getByRole("button", { name: "Go to message 1800" }));
    expect(onJump).toHaveBeenCalledWith(1800);
  });

  it("leaves an ordinary number alone", () => {
    body("3096/3096 tests and #1 on the list", { onJump: vi.fn() });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("refuses a seq this channel cannot hold — plain text, never a dead pill", () => {
    body("re #9001", { newestSeq: 2000, onJump: vi.fn() });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/#9001/)).toBeTruthy();
  });

  it("draws nothing at all when the pane knows no ceiling", () => {
    // ⚠ A pane with no page loaded cannot say which seqs exist; guessing would
    // advertise destinations it cannot reach (INVARIANTS §11).
    body("re #1759", { newestSeq: null, onJump: vi.fn() });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is INERT on a host that hands no handler — absent, not disabled", () => {
    // The pop-out and the guest lane have no transcript to move. Same rule the
    // attribution pill follows: a control that cannot act must not look like it can.
    body("re #1759");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/#1759/)).toBeTruthy();
  });

  it("never rewrites the message — every character of the body survives", () => {
    const text = "re #1759 and seq 1800, plus #1 which is not one";
    body(text, { onJump: vi.fn() });
    expect(document.body.textContent).toContain(text);
  });

  it("coexists with an @-mention in one line", () => {
    // Different namespaces: a handle never contains `#`, so mentions resolve first
    // and the citation leaf walks what is left.
    body("@sam re #1759", { onJump: vi.fn() });
    expect(screen.getByRole("button", { name: "Go to message 1759" })).toBeTruthy();
  });
});

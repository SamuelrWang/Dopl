import { describe, expect, it } from "vitest";
import { cn } from "@/shared/lib/utils";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { TAB_ACTION, TAB_ACTION_INK, TAB_ACTION_SHELL } from "./bits";

const classes = (s: string) => [...new Set(s.split(/\s+/).filter(Boolean))].sort();

describe("TAB_ACTION is PAGE_ACTION_BTN, not a second cut of it (X10)", () => {
  it("composes the shared page-action face", () => {
    expect(TAB_ACTION).toContain("auth-btn-3d");
    for (const token of PAGE_ACTION_BTN.split(/\s+/)) {
      expect(classes(TAB_ACTION)).toContain(token);
    }
  });

  it("adds only the two things a tab action needs on top of it", () => {
    const extra = classes(TAB_ACTION).filter((c) => !PAGE_ACTION_BTN.split(/\s+/).includes(c));
    expect(extra).toEqual(["gap-1", "shrink-0"]);
  });

  /**
   * The split button cannot wear one class string, so the halves exist — but a
   * hand-cut half is how this drifted before. Assert they still add up.
   */
  it("SHELL + INK reassemble the same face", () => {
    expect(classes(cn(TAB_ACTION_SHELL, "shrink-0 cursor-pointer items-center", TAB_ACTION_INK)))
      .toEqual(classes(TAB_ACTION));
  });
});

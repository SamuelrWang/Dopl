import { describe, expect, it } from "vitest";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { TAB_ACTION, TAB_ACTION_INK, TAB_ACTION_SHELL } from "./bits";

const classes = (s: string) => [...new Set(s.split(/\s+/).filter(Boolean))].sort();

describe("TAB_ACTION is the ink lg pill, not a second cut of it (X10)", () => {
  it("composes the shared page-action face, with its own gap", () => {
    expect(TAB_ACTION).toContain("raise-ink");
    for (const token of pillButton("ink", "lg").split(/\s+/)) {
      if (token.startsWith("gap-")) continue;
      expect(classes(TAB_ACTION)).toContain(token);
    }
  });

  it("adds only the two things a tab action needs on top of it", () => {
    const extra = classes(TAB_ACTION).filter((c) => !pillButton("ink", "lg").split(/\s+/).includes(c));
    expect(extra).toEqual(["gap-1", "shrink-0"]);
  });

  /**
   * The split button cannot wear one class string, so the halves exist — but a
   * hand-cut half is how this drifted before. Assert they still add up.
   */
  it("SHELL + INK reassemble the same face", () => {
    expect(classes(cn(TAB_ACTION_SHELL, "shrink-0 items-center", TAB_ACTION_INK)))
      .toEqual(classes(TAB_ACTION));
  });
});
